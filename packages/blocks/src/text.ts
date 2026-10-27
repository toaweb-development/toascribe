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

/** The longest address kept as a link reference (a longer one is not a link anyone follows). */
const MAX_LINK_LENGTH = 2000

function inlineLinks(nodes: readonly InlineNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'text' ? (node.marks ?? []).flatMap((mark) => (mark.type === 'link' ? [mark.attrs.href] : [])) : [],
  )
}

/**
 * The links of a document (`content_ref` kind `link`, M1.4; broken links and «brukes på» later): the link marks in rich text and
 * tables, and the addresses of `format: href` attributes (a button's), with the block that holds each, once per block. Run it on a
 * document that passed `validateDocument`.
 */
export function documentLinkRefs(blocks: readonly Block[]): { href: string; blockId: string }[] {
  const refs: { href: string; blockId: string }[] = []
  const visit = (block: Block) => {
    const definition = getBlockDefinition(block.type)
    const found: string[] = []
    for (const [name, schema] of Object.entries(definition?.attributes ?? {})) {
      const value = block.attrs[name]
      if (schema.type === 'rich-text' && Array.isArray(value)) found.push(...inlineLinks(value as InlineNode[]))
      else if (schema.type === 'table' && Array.isArray(value)) {
        for (const row of value as InlineNode[][][]) for (const cell of row) found.push(...inlineLinks(cell))
      } else if (schema.type === 'string' && schema.format === 'href' && typeof value === 'string') found.push(value)
    }
    for (const href of new Set(found)) {
      if (href !== '' && href.length <= MAX_LINK_LENGTH) refs.push({ href, blockId: block.id })
    }
    block.children.forEach(visit)
  }
  blocks.forEach(visit)
  return refs
}
