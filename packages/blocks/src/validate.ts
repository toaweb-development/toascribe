// Checks a block tree against the block.json of every block in it (PLAN, «Regler for blokker» 1). The editor runs it before it
// saves and the api runs it again before it stores, so a request that skipped the editor gets the same answer.
import { z } from 'zod'

import type { Block } from './block.ts'
import { BLOCK_ID_PATTERN } from './block.ts'
import type { AttributeSchema, BlockDefinition } from './definition.ts'
import { inlineContentSchema, isSafeHref, isSafeMediaUrl } from './inline.ts'
import { canContain, getBlockDefinition } from './registry.ts'

/** Limits on a whole document. A safety cap, not a setting: far above what a person writes, low enough to keep a request cheap. */
export const DOCUMENT_LIMITS = { maxBlocks: 5000, maxDepth: 8 } as const

export interface ValidationIssue {
  /** Where: indexes and keys from the top of the document, e.g. `[2, 'children', 0, 'attrs', 'alt']`. */
  readonly path: readonly (string | number)[]
  readonly code:
    | 'invalid_shape'
    | 'invalid_id'
    | 'duplicate_id'
    | 'unknown_block'
    | 'unsupported_version'
    | 'not_allowed_here'
    | 'unknown_attribute'
    | 'invalid_attribute'
    | 'child_count'
    | 'too_large'
    | 'alt_required'
  readonly message: string
}

export type ValidationResult =
  { readonly ok: true; readonly blocks: Block[] } | { readonly ok: false; readonly issues: ValidationIssue[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const validators = new WeakMap<AttributeSchema, z.ZodType>()

/**
 * Rules of one block type that look at more than one attribute. An image needs its alt text unless it is decorative (WordPress'
 * guidance, PLAN «Visning»: «Alt-tekst er påkrevd når bildet ikke er dekorativt»); without a chosen file there is nothing to describe.
 */
function blockRules(type: string, attrs: Readonly<Record<string, unknown>>): ValidationIssue[] {
  if (type === 'core/image' && attrs['mediaId'] !== '' && attrs['decorative'] !== true) {
    const alt = attrs['alt']
    if (typeof alt !== 'string' || alt.trim() === '') {
      return [{ path: ['alt'], code: 'alt_required', message: 'Describe the image, or mark it as decorative' }]
    }
  }
  return []
}

/** The Zod check for one attribute schema of a block.json, made once per schema. */
export function attributeValidator(schema: AttributeSchema): z.ZodType {
  const cached = validators.get(schema)
  if (cached !== undefined) {
    return cached
  }
  let validator: z.ZodType
  switch (schema.type) {
    case 'string': {
      let base = z.string().max(schema.maxLength)
      if (schema.minLength !== undefined) {
        base = base.min(schema.minLength)
      }
      const allowed = schema.enum
      const isUrl = schema.format === 'url'
      const isHref = schema.format === 'href'
      const isUuid = schema.format === 'uuid'
      const isSlug = schema.format === 'slug'
      validator = base
        .refine((value) => value.isWellFormed(), { message: 'Not well-formed text' })
        .refine((value) => allowed === undefined || allowed.includes(value), {
          message: 'Not one of the allowed values',
        })
        // An empty address is the default: «no image chosen yet».
        .refine((value) => !isUrl || value === '' || isSafeMediaUrl(value), { message: 'Not an allowed address' })
        .refine((value) => !isHref || value === '' || isSafeHref(value), { message: 'Not an allowed link address' })
        .refine((value) => !isUuid || value === '' || UUID.test(value), { message: 'Not an id' })
        // A slug of the site's own (a global set's): what an address segment may hold, nothing that could step out of it.
        .refine((value) => !isSlug || value === '' || /^[a-z0-9][a-z0-9-]{0,63}$/.test(value), {
          message: 'Not a slug',
        })
      break
    }
    case 'number':
    case 'integer': {
      let base = schema.type === 'integer' ? z.int() : z.number()
      if (schema.minimum !== undefined) {
        base = base.min(schema.minimum)
      }
      if (schema.maximum !== undefined) {
        base = base.max(schema.maximum)
      }
      const allowed = schema.enum
      validator = base.refine((value) => allowed === undefined || allowed.includes(value), {
        message: 'Not one of the allowed values',
      })
      break
    }
    case 'boolean':
      validator = z.boolean()
      break
    case 'rich-text':
      validator = inlineContentSchema(schema.maxLength)
      break
    case 'table': {
      const cell = inlineContentSchema(schema.cellMaxLength)
      validator = z
        .array(z.array(cell).min(1).max(schema.maxColumns))
        .min(1)
        .max(schema.maxRows)
        .refine((rows) => rows.every((row) => row.length === rows[0]?.length), {
          message: 'Every row must have the same number of cells',
        })
      break
    }
    default:
      schema satisfies never
      throw new Error('unknown attribute type')
  }
  validators.set(schema, validator)
  return validator
}

/**
 * Checks attributes against a block's definition. Unknown keys are refused, missing ones take the default. Returns the attributes
 * as they should be stored (with the defaults) or the issues, with paths that start at the attribute's key.
 */
export function validateAttrs(
  definition: BlockDefinition,
  attrs: unknown,
): { ok: true; attrs: Record<string, unknown> } | { ok: false; issues: ValidationIssue[] } {
  if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) {
    return { ok: false, issues: [{ path: [], code: 'invalid_shape', message: 'attrs must be an object' }] }
  }
  const issues: ValidationIssue[] = []
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(attrs)) {
    if (!Object.hasOwn(definition.attributes, key)) {
      issues.push({ path: [key], code: 'unknown_attribute', message: `${definition.name} has no attribute ${key}` })
    }
  }
  for (const [key, schema] of Object.entries(definition.attributes)) {
    const value: unknown = Object.hasOwn(attrs, key) ? Reflect.get(attrs, key) : structuredClone(schema.default)
    const parsed = attributeValidator(schema).safeParse(value)
    if (parsed.success) {
      result[key] = parsed.data
    } else {
      for (const issue of parsed.error.issues) {
        issues.push({
          path: [key, ...issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part))],
          code: 'invalid_attribute',
          message: issue.message,
        })
      }
    }
  }
  return issues.length === 0 ? { ok: true, attrs: result } : { ok: false, issues }
}

const BLOCK_KEYS = ['id', 'type', 'version', 'attrs', 'children'] as const

/**
 * Checks a whole document: the shape of each block, unique ids, known types at their current version, where each block stands
 * (`parent` / `allowedBlocks`), the number of children (`childCount`) and every attribute. Collects all issues instead of
 * stopping at the first, so the editor can mark each block. On success returns the document with defaults filled in. `parentType`
 * checks the list as the children of a block of that type instead of a document (blocks pasted into a column, a list).
 */
export function validateDocument(input: unknown, parentType: string | null = null): ValidationResult {
  const issues: ValidationIssue[] = []
  const ids = new Set<string>()
  let count = 0

  function visit(
    node: unknown,
    path: (string | number)[],
    parentType: string | null,
    depth: number,
  ): Block | undefined {
    count += 1
    if (count > DOCUMENT_LIMITS.maxBlocks) {
      // Past the cap nothing more is looked at; the caller answers `too_large`.
      return undefined
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      issues.push({ path, code: 'invalid_shape', message: 'A block must be an object' })
      return undefined
    }
    const keys = Object.keys(node)
    const extra = keys.filter((key) => !BLOCK_KEYS.some((known) => known === key))
    const missing = BLOCK_KEYS.filter((key) => !keys.includes(key))
    if (extra.length > 0 || missing.length > 0) {
      issues.push({
        path,
        code: 'invalid_shape',
        message: `A block has exactly id, type, version, attrs and children${extra.length > 0 ? ` (extra: ${extra.join(', ')})` : ''}`,
      })
      return undefined
    }
    const id: unknown = Reflect.get(node, 'id')
    const type: unknown = Reflect.get(node, 'type')
    const version: unknown = Reflect.get(node, 'version')
    const children: unknown = Reflect.get(node, 'children')

    if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) {
      issues.push({ path: [...path, 'id'], code: 'invalid_id', message: 'Not a block id' })
    } else if (ids.has(id)) {
      issues.push({ path: [...path, 'id'], code: 'duplicate_id', message: `The id ${id} is used twice` })
    } else {
      ids.add(id)
    }
    const definition = typeof type === 'string' ? getBlockDefinition(type) : undefined
    if (definition === undefined) {
      issues.push({ path: [...path, 'type'], code: 'unknown_block', message: 'Unknown block type' })
      return undefined
    }
    if (version !== definition.version) {
      issues.push({
        path: [...path, 'version'],
        code: 'unsupported_version',
        message: `${definition.name} is at version ${String(definition.version)}`,
      })
    }
    if (!canContain(parentType, definition.name)) {
      issues.push({
        path: [...path, 'type'],
        code: 'not_allowed_here',
        message: `${definition.name} cannot stand ${parentType === null ? 'at the top level' : `in ${parentType}`}`,
      })
    }
    const attrs = validateAttrs(definition, Reflect.get(node, 'attrs'))
    if (!attrs.ok) {
      issues.push(...attrs.issues.map((issue) => ({ ...issue, path: [...path, 'attrs', ...issue.path] })))
    } else {
      const ruleIssues = blockRules(definition.name, attrs.attrs)
      issues.push(...ruleIssues.map((issue) => ({ ...issue, path: [...path, 'attrs', ...issue.path] })))
      if (ruleIssues.length > 0) {
        return undefined
      }
    }
    if (!Array.isArray(children)) {
      issues.push({ path: [...path, 'children'], code: 'invalid_shape', message: 'children must be an array' })
      return undefined
    }
    const childList = children as unknown[]
    const { childCount } = definition
    if (childCount !== undefined && (childList.length < childCount.min || childList.length > childCount.max)) {
      issues.push({
        path: [...path, 'children'],
        code: 'child_count',
        message: `${definition.name} takes ${String(childCount.min)} to ${String(childCount.max)} children`,
      })
    }
    if (depth >= DOCUMENT_LIMITS.maxDepth && childList.length > 0) {
      issues.push({ path: [...path, 'children'], code: 'too_large', message: 'The blocks are nested too deep' })
      return undefined
    }
    const visited = childList.map((child, index) =>
      visit(child, [...path, 'children', index], definition.name, depth + 1),
    )
    if (!attrs.ok || typeof id !== 'string' || visited.some((child) => child === undefined)) {
      return undefined
    }
    return {
      id,
      type: definition.name,
      version: definition.version,
      attrs: attrs.attrs,
      children: visited.filter((child) => child !== undefined),
    }
  }

  if (!Array.isArray(input)) {
    return { ok: false, issues: [{ path: [], code: 'invalid_shape', message: 'A document is an array of blocks' }] }
  }
  const document = input as unknown[]
  if (document.length > DOCUMENT_LIMITS.maxBlocks) {
    return { ok: false, issues: [{ path: [], code: 'too_large', message: 'Too many blocks' }] }
  }
  const blocks: Block[] = []
  for (const [index, node] of document.entries()) {
    const block = visit(node, [index], parentType, 1)
    if (block !== undefined) {
      blocks.push(block)
    }
    if (count > DOCUMENT_LIMITS.maxBlocks) {
      return { ok: false, issues: [{ path: [], code: 'too_large', message: 'Too many blocks' }] }
    }
  }
  return issues.length === 0 ? { ok: true, blocks } : { ok: false, issues }
}
