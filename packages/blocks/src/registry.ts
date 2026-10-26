// The core blocks of the prototype (M0.6): paragraph, image, columns and column. Each block's `block.json` is the one source; the
// editor, the api and the view read it from here.
import columnJson from './column/block.json' with { type: 'json' }
import columnsJson from './columns/block.json' with { type: 'json' }
import imageJson from './image/block.json' with { type: 'json' }
import paragraphJson from './paragraph/block.json' with { type: 'json' }
import { BlockDefinition } from './definition.ts'

export const PARAGRAPH = 'core/paragraph'
export const IMAGE = 'core/image'
export const COLUMNS = 'core/columns'
export const COLUMN = 'core/column'

/** Parsed when the module loads: a block.json that does not fit the definition schema stops the api and the editor at once. */
export const CORE_BLOCKS: readonly BlockDefinition[] = [paragraphJson, imageJson, columnsJson, columnJson].map((json) =>
  BlockDefinition.parse(json),
)

const BY_NAME = new Map(CORE_BLOCKS.map((definition) => [definition.name, definition]))

export function getBlockDefinition(name: string): BlockDefinition | undefined {
  return BY_NAME.get(name)
}

/**
 * True when a block of type `child` may stand directly in `parent` (`null` for the top level of a document): the parent's
 * `allowedBlocks` lists it, and the child's `parent`, if it has one, names the parent. A block with a `parent` is never top-level.
 */
export function canContain(parent: string | null, child: string): boolean {
  const childDefinition = BY_NAME.get(child)
  if (childDefinition === undefined) {
    return false
  }
  if (parent === null) {
    return childDefinition.parent === null
  }
  if (BY_NAME.get(parent)?.allowedBlocks.includes(child) !== true) {
    return false
  }
  return childDefinition.parent === null || childDefinition.parent.includes(parent)
}

/** The blocks an inserter offers for a place: the ones that may stand there, in the registry's order. */
export function insertableBlocks(parent: string | null): BlockDefinition[] {
  return CORE_BLOCKS.filter((definition) => canContain(parent, definition.name))
}
