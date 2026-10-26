import type { Block, BlockDocument, InlineMark, InlineNode } from '../src/index.ts'
import { createBlock } from '../src/index.ts'

/** Text as inline content. */
export const text = (value: string, marks?: InlineMark[]): InlineNode[] =>
  marks === undefined ? [{ type: 'text', text: value }] : [{ type: 'text', text: value, marks }]

export const p = (id: string, value = ''): Block =>
  createBlock('core/paragraph', { content: value === '' ? [] : text(value) }, [], id)

/** An image block with a chosen file (a media id) and its alt text. */
export const MEDIA_ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'
export const img = (id: string, mediaId = MEDIA_ID): Block =>
  createBlock('core/image', { mediaId, alt: 'An image' }, [], id)

export const col = (id: string, ...children: Block[]): Block => createBlock('core/column', {}, children, id)

export const cols = (id: string, ...columns: Block[]): Block => createBlock('core/columns', {}, columns, id)

/** The shape of a document as ids, nested: `['a', ['c1', ['x'], 'c2', []]]` is hard to read, so this gives `a cols(c1(x) c2())`. */
export function outline(document: BlockDocument): string {
  return document
    .map((block) =>
      block.children.length === 0 && block.type !== 'core/column'
        ? block.id
        : `${block.id}(${outline(block.children)})`,
    )
    .join(' ')
}
