// WordPress block markup to a block tree, until toascribe has a block format of its own (M0.6 editor prototype, M1.3
// core blocks). Each node is what WordPress' parse_blocks() returns for it (WP_Block_Parser, WordPress 7.1.3):
// `blockName` with the core/ namespace made explicit, `attrs` from the comment's JSON, `innerBlocks`, `innerHTML` (the
// block's own HTML without its children) and `innerContent` (that HTML in pieces, with null where each child goes).
// The one difference: whitespace between top-level blocks, which parse_blocks() returns as null-named freeform blocks,
// is dropped, as the block editor does. So the tree loses nothing that renders, and the WXR importer (phase 2) and the
// converter that M1.3 needs can start from the same WordPress shape. Only the subset the default content uses has to
// work, but anything unbalanced or outside a block throws instead of being stored half-read.
import { JsonObject } from '@toascribe/shared'
import type { JsonValue } from '@toascribe/shared'

/** One node, a JSON object, so a tree of them is a `Blocks` value for content.blocks. */
export interface ParsedBlock {
  [key: string]: JsonValue
  blockName: string
  attrs: JsonObject
  innerBlocks: ParsedBlock[]
  innerHTML: string
  innerContent: (string | null)[]
}

// WP_Block_Parser::next_token(), without PCRE's possessive quantifier, which JavaScript lacks.
const TOKEN = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+(\{[\s\S]*?\}\s+)?(\/)?-->/g

function attributes(json: string | undefined): JsonObject {
  return json === undefined ? {} : JsonObject.parse(JSON.parse(json))
}

/** Parses WordPress block markup. Throws on text outside a block and on unbalanced or mismatched comments. */
export function parseBlockMarkup(markup: string): ParsedBlock[] {
  const top: ParsedBlock[] = []
  const stack: ParsedBlock[] = []
  let offset = 0

  const text = (chunk: string): void => {
    const parent = stack.at(-1)
    if (parent === undefined) {
      if (chunk.trim() !== '') {
        throw new Error('block markup has text outside a block')
      }
      return
    }
    if (chunk !== '') {
      parent.innerHTML += chunk
      parent.innerContent.push(chunk)
    }
  }
  const add = (block: ParsedBlock): void => {
    const parent = stack.at(-1)
    if (parent === undefined) {
      top.push(block)
    } else {
      parent.innerBlocks.push(block)
      parent.innerContent.push(null)
    }
  }

  for (const match of markup.matchAll(TOKEN)) {
    text(markup.slice(offset, match.index))
    offset = match.index + match[0].length
    const [, closer, namespace, name, json, isVoid] = match
    const blockName = `${namespace ?? 'core/'}${name ?? ''}`
    if (closer !== undefined) {
      const open = stack.pop()
      if (open?.blockName !== blockName) {
        throw new Error(`block markup closes ${blockName} without opening it`)
      }
      add(open)
    } else {
      const block: ParsedBlock = {
        blockName,
        attrs: attributes(json),
        innerBlocks: [],
        innerHTML: '',
        innerContent: [],
      }
      if (isVoid === undefined) {
        stack.push(block)
      } else {
        add(block)
      }
    }
  }
  text(markup.slice(offset))
  if (stack.length > 0) {
    throw new Error(`block markup leaves ${stack.map((b) => b.blockName).join(', ')} open`)
  }
  return top
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
}

/** The text of an HTML fragment: tags dropped, character references decoded (the ones the default content uses). */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity: string, ref: string) => {
      if (ref.startsWith('#x') || ref.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(ref.slice(2), 16))
      }
      if (ref.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(ref.slice(1), 10))
      }
      return NAMED_ENTITIES[ref.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** The visible text of a block tree, in document order, for the full-text vector. */
export function blocksText(blocks: readonly ParsedBlock[]): string {
  return blocks
    .map((block) => [htmlToText(block.innerHTML), blocksText(block.innerBlocks)].filter((t) => t !== '').join(' '))
    .filter((t) => t !== '')
    .join(' ')
}
