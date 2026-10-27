// The words of a block document, for the search vector (`content.search`, weight C; DATAMODEL «Full-text search»). Only the block
// registry knows which attributes hold text: a `rich-text` attribute gives its text, a `string` attribute gives its value unless it
// is an address or an id (`format`) or a choice from a list (`enum`). Run it on a document that passed `validateDocument`.
import type { Block } from './block.ts'
import type { InlineNode } from './inline.ts'
import { inlineText } from './inline.ts'
import { getBlockDefinition } from './registry.ts'

function blockText(block: Block): string[] {
  const definition = getBlockDefinition(block.type)
  const own: string[] = []
  if (definition !== undefined) {
    for (const [name, schema] of Object.entries(definition.attributes)) {
      const value = block.attrs[name]
      if (schema.type === 'rich-text' && Array.isArray(value)) {
        own.push(inlineText(value as InlineNode[]))
      } else if (schema.type === 'table' && Array.isArray(value)) {
        for (const row of value as InlineNode[][][]) for (const cell of row) own.push(inlineText(cell))
      } else if (
        schema.type === 'string' &&
        typeof value === 'string' &&
        schema.format === undefined &&
        schema.enum === undefined
      ) {
        own.push(value)
      }
    }
  }
  return [...own, ...block.children.flatMap(blockText)]
}

/** The text of every block, in document order, separated by spaces. Empty pieces are left out. */
export function documentText(blocks: readonly Block[]): string {
  return blocks
    .flatMap(blockText)
    .map((piece) => piece.replace(/\s+/g, ' ').trim())
    .filter((piece) => piece !== '')
    .join(' ')
}
