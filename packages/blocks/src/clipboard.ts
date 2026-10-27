// Copy, cut and paste of blocks (M1.3; decision note 0001, adjustment 3). Blocks go to the clipboard as JSON under their own type,
// with plain text beside it for other programs; what comes back is checked like anything the api stores (validateDocument, at the
// place it goes) and gets new ids, so a paste never meets the blocks it was copied from. Plain text becomes paragraphs. Pasting from
// Word and Google Docs (K-092, their HTML) is phase 2: today their plain text is taken.
import type { Block } from './block.ts'
import { cloneWithNewIds, createParagraph } from './block.ts'
import type { InlineNode } from './inline.ts'
import { documentText } from './text.ts'
import { validateDocument } from './validate.ts'

/** The clipboard type of copied blocks. */
export const BLOCKS_MIME = 'application/x-toascribe-blocks'

/** The most blocks one paste puts in (a safety cap; far more than a person copies). */
export const MAX_PASTED_BLOCKS = 500

/** Blocks as the clipboard holds them. */
export function serializeBlocks(blocks: readonly Block[]): string {
  return JSON.stringify({ format: 'toascribe-blocks', version: 1, blocks })
}

/**
 * The blocks of a clipboard payload, checked for the place they go (`parentType`: null for the top level) and with new ids; undefined
 * when the payload is not blocks, or when one of them may not stand there.
 */
export function parseClipboardBlocks(payload: string, parentType: string | null): Block[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'format') !== 'toascribe-blocks') {
    return undefined
  }
  const blocks: unknown = Reflect.get(data, 'blocks')
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_PASTED_BLOCKS) {
    return undefined
  }
  const checked = validateDocument(blocks, parentType)
  return checked.ok ? checked.blocks.map(cloneWithNewIds) : undefined
}

/** The plain text of blocks for other programs: one block's text per paragraph. */
export function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => documentText([block]))
    .filter((text) => text !== '')
    .join('\n\n')
}

/** The inline content of one paragraph of plain text: a single line break is a hard break. */
function lineContent(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  text.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line !== '') nodes.push({ type: 'text', text: line })
  })
  return nodes
}

/** Plain text as paragraphs, one or more (`toa post create --content`, M1.7): none for empty text. */
export function textToParagraphs(text: string): Block[] {
  const many = textToBlocks(text)
  if (many !== undefined) return many
  const one = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  return one.trim() === '' ? [] : [createParagraph(lineContent(one))]
}

/**
 * Plain text as paragraphs, as Gutenberg reads it: an empty line starts a new paragraph, a single line break stays a line break.
 * Undefined for text of one paragraph (the text block takes it as it is).
 */
export function textToBlocks(text: string): Block[] | undefined {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^\n+|\n+$/g, ''))
    .filter((part) => part.trim() !== '')
  if (paragraphs.length < 2 || paragraphs.length > MAX_PASTED_BLOCKS) {
    return undefined
  }
  return paragraphs.map((part) => createParagraph(lineContent(part)))
}
