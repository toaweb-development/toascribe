// Copy, cut and paste of blocks (M1.3, decision note 0001 adjustment 3): the clipboard's JSON, checked for the place it goes and given
// new ids; plain text as paragraphs; and the selection over several blocks (siblings, and across parents as Gutenberg does). The
// editor model's steps for them (one undo each) are in model.test.ts.
import { describe, expect, it } from 'vitest'

import type { Block } from '../src/index.ts'
import {
  BLOCKS_MIME,
  blocksToText,
  createBlock,
  createEditorModel,
  endList,
  mayEditBlockType,
  parseClipboardBlocks,
  selectionEnds,
  serializeBlocks,
  siblingRange,
  textToBlocks,
} from '../src/index.ts'
import { col, cols, img, outline, p, text } from './fixtures.ts'

const item = (id: string, value = ''): Block =>
  createBlock('core/list-item', { content: value === '' ? [] : text(value) }, [], id)

describe('blocks on the clipboard', () => {
  it('go out as JSON under their own type and come back with new ids', () => {
    expect(BLOCKS_MIME).toBe('application/x-toascribe-blocks')
    const copied = [p('b_aaaa', 'En'), img('b_img1')]
    const pasted = parseClipboardBlocks(serializeBlocks(copied), null) ?? []
    expect(pasted.map((block) => block.type)).toEqual(['core/paragraph', 'core/image'])
    expect(pasted.map((block) => block.id)).not.toContain('b_aaaa')
    expect(pasted[0]?.attrs['content']).toEqual(text('En'))
  })

  it('are checked for the place they go: a list item only in a list, a column never at the top level', () => {
    const items = serializeBlocks([item('b_itm1', 'Punkt')])
    expect(parseClipboardBlocks(items, null)).toBeUndefined()
    expect(parseClipboardBlocks(items, 'core/list')).toHaveLength(1)
    expect(parseClipboardBlocks(serializeBlocks([col('b_col1', p('b_p001'))]), null)).toBeUndefined()
    // Into a column: a paragraph and an image may stand there.
    expect(parseClipboardBlocks(serializeBlocks([p('b_p002', 'x'), img('b_img2')]), 'core/column')).toHaveLength(2)
  })

  it('refuse what is not blocks, and blocks that do not pass their block.json', () => {
    expect(parseClipboardBlocks('<p>hei</p>', null)).toBeUndefined()
    expect(parseClipboardBlocks(JSON.stringify({ format: 'other', blocks: [] }), null)).toBeUndefined()
    const bad = { ...p('b_p003', 'x'), attrs: { content: [{ type: 'text', text: 'x', marks: [{ type: 'script' }] }] } }
    expect(
      parseClipboardBlocks(JSON.stringify({ format: 'toascribe-blocks', version: 1, blocks: [bad] }), null),
    ).toBeUndefined()
  })

  it('give other programs their text, a paragraph each', () => {
    expect(blocksToText([p('b_p004', 'En'), createBlock('core/heading', { content: text('To') })])).toBe('En\n\nTo')
  })
})

describe('a crafted clipboard payload', () => {
  const payload = (blocks: unknown[]) => JSON.stringify({ format: 'toascribe-blocks', version: 1, blocks })
  const paragraphWithLink = (href: string) => ({
    ...p('b_link', ''),
    attrs: { content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }] },
  })

  it('cannot bring a javascript:, data: or another-host link', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/x', 'java\tscript:x']) {
      expect(parseClipboardBlocks(payload([paragraphWithLink(href)]), null), href).toBeUndefined()
    }
    expect(parseClipboardBlocks(payload([paragraphWithLink('https://example.com/')]), null)).toHaveLength(1)
  })

  it('cannot bring an unknown block type, extra keys on a block, or an attribute its block.json does not have', () => {
    expect(parseClipboardBlocks(payload([{ ...p('b_x001'), type: 'evil/script' }]), null)).toBeUndefined()
    expect(parseClipboardBlocks(payload([{ ...p('b_x002'), html: '<script>' }]), null)).toBeUndefined()
    expect(
      parseClipboardBlocks(payload([{ ...p('b_x003'), attrs: { content: [], onclick: 'x' } }]), null),
    ).toBeUndefined()
  })

  it('carries custom HTML as data; who may put it in is the editor’s and the api’s check (mayEditBlockType)', () => {
    const html = { id: 'b_html', type: 'core/html', version: 1, attrs: { content: '<script>x</script>' }, children: [] }
    const pasted = parseClipboardBlocks(payload([html]), null) ?? []
    expect(pasted.map((block) => block.type)).toEqual(['core/html'])
    expect(mayEditBlockType('core/html', new Set(['edit_posts']))).toBe(false)
    expect(mayEditBlockType('core/html', new Set(['unfiltered_html']))).toBe(true)
  })
})

describe('plain text pasted', () => {
  it('becomes a paragraph per empty-line-separated part, a single line break a hard break', () => {
    const blocks = textToBlocks('Første avsnitt\nmed to linjer\n\nAndre avsnitt\r\n\r\n\r\nTredje') ?? []
    expect(blocks.map((block) => block.type)).toEqual(['core/paragraph', 'core/paragraph', 'core/paragraph'])
    expect(blocks[0]?.attrs['content']).toEqual([
      ...text('Første avsnitt'),
      { type: 'hardBreak' },
      ...text('med to linjer'),
    ])
    expect(blocks[2]?.attrs['content']).toEqual(text('Tredje'))
  })

  it('of one paragraph is left to the text block', () => {
    expect(textToBlocks('Bare én linje')).toBeUndefined()
    expect(textToBlocks('To linjer\nuten tom linje')).toBeUndefined()
  })
})

describe('a selection over several blocks', () => {
  const document = [
    p('b_aaaa'),
    cols('b_cols', col('b_col1', p('b_xxxx'), p('b_yyyy')), col('b_col2', p('b_zzzz'))),
    p('b_bbbb'),
  ]

  it('takes the siblings between two blocks', () => {
    expect(siblingRange(document, 'b_bbbb', 'b_aaaa')).toEqual(['b_aaaa', 'b_cols', 'b_bbbb'])
    expect(siblingRange(document, 'b_xxxx', 'b_yyyy')).toEqual(['b_xxxx', 'b_yyyy'])
    expect(siblingRange(document, 'b_xxxx', 'b_aaaa')).toBeUndefined()
  })

  it('across parents, runs between their ancestors under the common parent', () => {
    expect(selectionEnds(document, 'b_aaaa', 'b_zzzz')).toEqual(['b_aaaa', 'b_cols'])
    expect(selectionEnds(document, 'b_yyyy', 'b_zzzz')).toEqual(['b_col1', 'b_col2'])
    expect(selectionEnds(document, 'b_xxxx', 'b_yyyy')).toEqual(['b_xxxx', 'b_yyyy'])
  })
})

describe('the model: paste, cut and the end of a list, one step each', () => {
  it('pastes into a column and cuts several blocks, each undone in one step', () => {
    const model = createEditorModel([
      p('b_aaaa', 'a'),
      cols('b_cols', col('b_col1', p('b_xxxx')), col('b_col2')),
      p('b_bbbb'),
    ])
    const pasted =
      parseClipboardBlocks(serializeBlocks([p('b_c001', 'kopi'), p('b_c002', 'kopi 2')]), 'core/column') ?? []
    model.insertMany({ parentId: 'b_col2', index: 0 }, pasted, { blockId: 'b_xxxx' })
    expect(model.document[1]?.children[1]?.children).toHaveLength(2)
    model.removeMany(['b_aaaa', 'b_bbbb'], { blockId: 'b_aaaa' })
    expect(outline(model.document)).toMatch(/^b_cols\(/)
    model.undo()
    expect(outline(model.document)).toMatch(/^b_aaaa b_cols\(.*\) b_bbbb$/)
    model.undo()
    expect(model.document[1]?.children[1]?.children).toHaveLength(0)
    model.redo()
    model.redo()
    expect(outline(model.document)).toMatch(/^b_cols\(/)
  })

  it('Enter in the empty last item ends the list with a paragraph after it', () => {
    const list = createBlock('core/list', {}, [item('b_itm1', 'En'), item('b_itm2')], 'b_lst1')
    const ended = endList([list, p('b_after')], 'b_itm2')
    expect(outline(ended?.document ?? [])).toMatch(/^b_lst1\(b_itm1\) b_[0-9a-f]+ b_after$/)
    expect(endList([list], 'b_itm1')).toBeUndefined()
    const only = createBlock('core/list', {}, [item('b_itm3')], 'b_lst2')
    expect(endList([only], 'b_itm3')?.document.map((block) => block.type)).toEqual(['core/paragraph'])
  })
})
