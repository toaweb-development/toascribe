// Block migrations (PLAN «Versjonering i stedet for "deprecated"»): when a block's `version` goes up, the block's `migrate` function
// upgrades a stored block of the older version once, instead of the block carrying every old form. `migrateDocument` walks a stored
// tree and upgrades every block it has a step for, before the tree is validated; it changes nothing it does not know. The context
// gives what a step may need from outside (a media id for an address), so the steps stay pure TypeScript.
import { migrateImageV1 } from './image/migrate.ts'
import { IMAGE } from './registry.ts'

export interface MigrationContext {
  /** The media library's id of a file at this address, or undefined. */
  readonly mediaIdForUrl: (url: string) => string | undefined
}

type Step = (attrs: Readonly<Record<string, unknown>>, context: MigrationContext) => Record<string, unknown>

/** Block type → version → the step that takes a block of that version to the next. */
const STEPS: Readonly<Record<string, Readonly<Record<number, Step>>>> = {
  [IMAGE]: { 1: migrateImageV1 },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateNode(node: unknown, context: MigrationContext): { node: unknown; changed: boolean } {
  if (!isRecord(node)) {
    return { node, changed: false }
  }
  let changed = false
  let result: Record<string, unknown> = node
  const type = node['type']
  const steps = typeof type === 'string' ? STEPS[type] : undefined
  let version = node['version']
  while (steps !== undefined && typeof version === 'number' && steps[version] !== undefined) {
    const step = steps[version]
    if (step === undefined) break
    result = { ...result, version: version + 1, attrs: step(isRecord(result['attrs']) ? result['attrs'] : {}, context) }
    version = version + 1
    changed = true
  }
  const children = result['children']
  if (Array.isArray(children)) {
    const migrated = (children as unknown[]).map((child) => migrateNode(child, context))
    if (migrated.some((entry) => entry.changed)) {
      result = { ...result, children: migrated.map((entry) => entry.node) }
      changed = true
    }
  }
  return { node: result, changed }
}

/** The tree with every block upgraded to its current version where a step exists; the same array when nothing changed. */
export function migrateDocument(input: unknown, context: MigrationContext): { blocks: unknown; changed: boolean } {
  if (!Array.isArray(input)) {
    return { blocks: input, changed: false }
  }
  const migrated = (input as unknown[]).map((node) => migrateNode(node, context))
  return migrated.some((entry) => entry.changed)
    ? { blocks: migrated.map((entry) => entry.node), changed: true }
    : { blocks: input, changed: false }
}

/** The addresses of the image blocks of version 1 in a stored tree: what `mediaIdForUrl` will be asked for. */
export function legacyImageUrls(input: unknown): string[] {
  const urls: string[] = []
  const visit = (node: unknown) => {
    if (!isRecord(node)) return
    if (
      node['type'] === IMAGE &&
      node['version'] === 1 &&
      isRecord(node['attrs']) &&
      typeof node['attrs']['url'] === 'string'
    ) {
      urls.push(node['attrs']['url'])
    }
    if (Array.isArray(node['children'])) (node['children'] as unknown[]).forEach(visit)
  }
  if (Array.isArray(input)) (input as unknown[]).forEach(visit)
  return [...new Set(urls.filter((url) => url !== ''))]
}

/** The media a document uses (image blocks with a chosen file), with the block that holds each: the «Brukes på» references. */
export function documentMediaRefs(
  blocks: readonly {
    id: string
    type: string
    attrs: Readonly<Record<string, unknown>>
    children: readonly unknown[]
  }[],
): { mediaId: string; blockId: string }[] {
  const refs: { mediaId: string; blockId: string }[] = []
  const visit = (block: {
    id: string
    type: string
    attrs: Readonly<Record<string, unknown>>
    children: readonly unknown[]
  }) => {
    const mediaId = block.attrs['mediaId']
    if (block.type === IMAGE && typeof mediaId === 'string' && mediaId !== '') {
      refs.push({ mediaId, blockId: block.id })
    }
    for (const child of block.children) visit(child as typeof block)
  }
  blocks.forEach(visit)
  return refs
}
