// The shape of a `block.json` (docs/PLAN.md, «Blokkspesifikasjon»), and the subset of JSON Schema its attributes may use.
//
// A block.json is read by the editor and by the api, so the attribute schemas are checked by our own small validator
// (validate.ts) in both places rather than by a JSON Schema library: Ajv compiles with `new Function`, which the admin's CSP
// forbids, and Zod's `fromJSONSchema` is marked semi-experimental. The subset is what the core blocks need. A keyword outside it
// makes the definition itself invalid, so a block.json can never ask for a check that is silently not made (fail closed).
import { z } from 'zod'

/** `namespace/name`, e.g. `core/image` (PLAN: `name`). */
export const BlockName = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
export type BlockName = z.infer<typeof BlockName>

const Json = z.json()

/**
 * A string attribute. `format: 'url'` takes an http(s) address or a path on this site (inline.ts, isSafeMediaUrl); `format: 'uuid'`
 * takes an id (a media file's), or empty for none.
 */
const StringAttribute = z.strictObject({
  type: z.literal('string'),
  default: z.string(),
  maxLength: z.int().positive(),
  minLength: z.int().nonnegative().optional(),
  enum: z.array(z.string()).min(1).optional(),
  format: z.enum(['url', 'uuid']).optional(),
})

const NumberAttribute = z.strictObject({
  type: z.enum(['number', 'integer']),
  default: z.number(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.number()).min(1).optional(),
})

const BooleanAttribute = z.strictObject({ type: z.literal('boolean'), default: z.boolean() })

/**
 * Rich text (inline.ts): inline content as data, with the marks the editor allows. WordPress 6.5 names this type `rich-text`
 * too. `maxLength` counts characters.
 */
const RichTextAttribute = z.strictObject({
  type: z.literal('rich-text'),
  default: z.array(Json).length(0),
  maxLength: z.int().positive(),
})

export const AttributeSchema = z.discriminatedUnion('type', [
  StringAttribute,
  NumberAttribute,
  BooleanAttribute,
  RichTextAttribute,
])
export type AttributeSchema = z.infer<typeof AttributeSchema>

export const BlockDefinition = z.strictObject({
  name: BlockName,
  /** Raised when the attributes change; a `migrate.ts` upgrades older blocks (phase 1). */
  version: z.int().positive(),
  /** English; the admin shows its own translation (i18n key `blocks.<name>.title`). */
  title: z.string().min(1),
  description: z.string(),
  category: z.enum(['text', 'media', 'design', 'widgets', 'theme', 'embed']),
  /** An icon name the admin can draw (Nuxt UI, `i-lucide-*`). */
  icon: z.string().regex(/^i-lucide-[a-z0-9-]+$/),
  keywords: z.array(z.string()),
  attributes: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), AttributeSchema),
  /** The shared panels the core draws (alignment, colours ...). None in the prototype. */
  supports: z.strictObject({}),
  /** Where the block may stand: `null` anywhere a parent allows it, or the only parents it may have (it is then never top-level). */
  parent: z.array(BlockName).min(1).nullable(),
  /** Which blocks it takes as children. Empty: none. */
  allowedBlocks: z.array(BlockName),
  /** toascribe's addition (prototype): how many children it must have. WordPress has no field for this. */
  childCount: z.strictObject({ min: z.int().nonnegative(), max: z.int().positive() }).optional(),
})
export type BlockDefinition = z.infer<typeof BlockDefinition>

/** The default attributes of a block type. Copies, so a caller may keep them. */
export function defaultAttrs(definition: BlockDefinition): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definition.attributes).map(([key, schema]) => [key, structuredClone(schema.default)]),
  )
}
