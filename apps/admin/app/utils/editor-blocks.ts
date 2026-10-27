import type { BlockDefinition } from '@toascribe/blocks'
import { allowedInContentType, insertableBlocks, mayEditBlockType } from '@toascribe/blocks'

/** The account and the document the editor works on (useBlockEditor's scope). */
export interface EditorScope {
  readonly capabilities: ReadonlySet<string>
  readonly contentType: string
}

/**
 * The blocks the inserter, a block's toolbar and the «/» menu offer at a place: those that may stand there, that belong in the content
 * type («Les mer» in posts) and that the account may put in (custom HTML with unfiltered_html). The api checks the same on save.
 */
export function editorInsertableBlocks(parentType: string | null, scope: EditorScope): BlockDefinition[] {
  return insertableBlocks(parentType).filter(
    (definition) =>
      allowedInContentType(definition.name, scope.contentType) && mayEditBlockType(definition.name, scope.capabilities),
  )
}

/** The inserter's categories, in its order (block.json `category`). */
export const INSERTER_CATEGORIES = ['text', 'media', 'design', 'widgets', 'embed'] as const
export type InserterCategory = (typeof INSERTER_CATEGORIES)[number]
