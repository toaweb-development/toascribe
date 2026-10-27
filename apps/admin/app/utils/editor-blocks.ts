import type { BlockDefinition } from '@toascribe/blocks'
import { insertableBlocks } from '@toascribe/blocks'

/**
 * The blocks the editor can draw for editing. The block format has the whole basic set (M1.3), but until each block has its edit
 * component only these are offered; a stored block of another type is still validated and shown by the views.
 */
const EDITABLE: ReadonlySet<string> = new Set(['core/paragraph', 'core/image', 'core/columns', 'core/column'])

/** The blocks the inserter, a block's toolbar and the «/» menu offer at a place. */
export function editorInsertableBlocks(parentType: string | null): BlockDefinition[] {
  return insertableBlocks(parentType).filter((definition) => EDITABLE.has(definition.name))
}
