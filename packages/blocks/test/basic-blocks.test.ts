// The basic set of M1.3 (K-078, K-079): every block the inserter offers is valid as it is put in, each block refuses what its
// block.json does not allow (an uneven table, a button to javascript:, an image in a gallery without alt text), the text of every
// block reaches the search, and the list's keys (Enter, Backspace, Tab, Shift+Tab) as tree operations.
import { describe, expect, it } from 'vitest'

import type { Block } from '../src/index.ts'
import {
  CORE_BLOCKS,
  createBlock,
  createInsertable,
  documentText,
  indentListItem,
  insertableBlocks,
  mergeWithPrevious,
  outdentListItem,
  splitText,
  validateDocument,
} from '../src/index.ts'
import { MEDIA_ID, img, outline, p, text } from './fixtures.ts'

const item = (id: string, value: string, children: Block[] = []): Block =>
  createBlock('core/list-item', { content: text(value) }, children, id)
const list = (id: string, ...items: Block[]): Block => createBlock('core/list', {}, items, id)

function issuesOf(document: unknown): string[] {
  const result = validateDocument(document)
  return result.ok ? [] : result.issues.map((issue) => `${issue.code}@${issue.path.join('.')}`)
}

describe('the basic blocks as the inserter puts them in', () => {
  it.each(insertableBlocks(null).map((definition) => definition.name))('%s is valid at the top level', (type) => {
    expect(issuesOf([createInsertable(type)])).toEqual([])
  })

  it('has a definition for every block, with English words the admin translates', () => {
    for (const definition of CORE_BLOCKS) {
      expect(definition.title.length, definition.name).toBeGreaterThan(0)
    }
  })
})

describe('what each block refuses', () => {
  it('a table whose rows have different numbers of cells, or too many rows', () => {
    const table = (cells: unknown) => [{ ...createBlock('core/table'), attrs: { hasHeader: true, cells, caption: '' } }]
    expect(issuesOf(table([[text('a'), text('b')], [text('c')]]))).toEqual(['invalid_attribute@0.attrs.cells'])
    expect(issuesOf(table(Array.from({ length: 101 }, () => [[]])))[0]).toMatch(/^invalid_attribute@0\.attrs\.cells/)
    expect(
      issuesOf(
        table([
          [text('a'), text('b')],
          [text('c'), []],
        ]),
      ),
    ).toEqual([])
  })

  it('markup in a table cell: a cell is rich text, so a tag is text and an unknown node is refused', () => {
    const cells = [[[{ type: 'html', html: '<script>alert(1)</script>' }]]]
    expect(issuesOf([{ ...createBlock('core/table'), attrs: { hasHeader: false, cells, caption: '' } }])[0]).toMatch(
      /^invalid_attribute@0\.attrs\.cells/,
    )
  })

  it('a button that links to javascript:, and one to a page of this site', () => {
    const buttons = (url: string) => [
      createBlock('core/buttons', {}, [createBlock('core/button', { text: text('Les'), url }, [], 'b_btn1')], 'b_bts1'),
    ]
    expect(issuesOf(buttons('javascript:alert(1)'))).toEqual(['invalid_attribute@0.children.0.attrs.url'])
    expect(issuesOf(buttons('/om-oss'))).toEqual([])
    expect(issuesOf(buttons('mailto:post@example.com'))).toEqual([])
  })

  it('an image in a gallery without alt text, and anything but images in a gallery', () => {
    const noAlt = createBlock('core/image', { mediaId: MEDIA_ID, alt: '' }, [], 'b_img1')
    expect(issuesOf([createBlock('core/gallery', {}, [noAlt], 'b_gal1')])).toEqual([
      'alt_required@0.children.0.attrs.alt',
    ])
    expect(issuesOf([createBlock('core/gallery', {}, [p('b_par1')], 'b_gal1')])).toEqual([
      'not_allowed_here@0.children.0.type',
    ])
    expect(issuesOf([createBlock('core/gallery', { linkTo: 'attachment' }, [img('b_img2')], 'b_gal1')])).toEqual([
      'invalid_attribute@0.attrs.linkTo',
    ])
  })

  it('a heading level outside 1 to 6, a spacer outside its limits', () => {
    expect(issuesOf([createBlock('core/heading', { level: 7 })])).toEqual(['invalid_attribute@0.attrs.level'])
    expect(issuesOf([createBlock('core/spacer', { height: 2 })])).toEqual(['invalid_attribute@0.attrs.height'])
  })

  it('«Les mer» and a page break inside a container (they stand at the top level only)', () => {
    expect(issuesOf([createBlock('core/group', {}, [createBlock('core/more')], 'b_grp1')])).toEqual([
      'not_allowed_here@0.children.0.type',
    ])
    expect(issuesOf([createBlock('core/nextpage')])).toEqual([])
  })

  it('an empty list, and a list item with two nested lists', () => {
    expect(issuesOf([createBlock('core/list', {}, [], 'b_lst1')])).toEqual(['child_count@0.children'])
    const twice = item('b_itm1', 'a', [list('b_lst2', item('b_itm2', 'b')), list('b_lst3', item('b_itm3', 'c'))])
    expect(issuesOf([list('b_lst1', twice)])).toEqual(['child_count@0.children.0.children'])
  })

  it('the custom HTML block names the capability it needs, and «Les mer» the content type', () => {
    expect(CORE_BLOCKS.find((definition) => definition.name === 'core/html')?.capability).toBe('unfiltered_html')
    expect(CORE_BLOCKS.find((definition) => definition.name === 'core/more')?.contentTypes).toEqual(['post'])
  })
})

describe('the text of the blocks for the search', () => {
  it('takes headings, list items, table cells, code and the button text', () => {
    const document: Block[] = [
      createBlock('core/heading', { content: text('Overskrift') }),
      list('b_lst1', item('b_itm1', 'Punkt')),
      createBlock('core/table', { cells: [[text('Celle'), text('To')]] }),
      createBlock('core/code', { content: 'const svar = 42' }),
      createBlock('core/buttons', {}, [createBlock('core/button', { text: text('Knapp'), url: '/x' })]),
    ]
    expect(documentText(document)).toBe('Overskrift Punkt Celle To const svar = 42 Knapp')
  })
})

describe('the keys of a list as tree operations', () => {
  const start = (): Block[] => [list('b_lst1', item('b_aaaa', 'en'), item('b_bbbb', 'to'), item('b_cccc', 'tre'))]

  it('Enter in a list item makes the next list item; in a heading it makes a paragraph', () => {
    const split = splitText(start(), 'b_bbbb', text('t'), text('o'), 'b_new1')
    expect(outline(split?.document ?? [])).toBe('b_lst1(b_aaaa b_bbbb b_new1 b_cccc)')
    const heading = [createBlock('core/heading', { content: text('Tittel') }, [], 'b_head')]
    const after = splitText(heading, 'b_head', text('Tit'), text('tel'), 'b_new2')
    expect(after?.document[1]?.type).toBe('core/paragraph')
    expect(splitText([createBlock('core/preformatted', {}, [], 'b_pre1')], 'b_pre1', [], [])).toBeUndefined()
  })

  it('Tab puts an item in a list under the one before; Shift+Tab takes it back out', () => {
    const indented = indentListItem(start(), 'b_bbbb') ?? []
    expect(outline(indented)).toMatch(/^b_lst1\(b_aaaa\(b_[0-9a-f]+\(b_bbbb\)\) b_cccc\)$/)
    expect(issuesOf(indented)).toEqual([])
    // The next item goes into the same nested list.
    const both = indentListItem(indented, 'b_cccc') ?? []
    expect(outline(both)).toMatch(/^b_lst1\(b_aaaa\(b_[0-9a-f]+\(b_bbbb b_cccc\)\)\)$/)
    const out = outdentListItem(both, 'b_cccc') ?? []
    expect(outline(out)).toMatch(/^b_lst1\(b_aaaa\(b_[0-9a-f]+\(b_bbbb\)\) b_cccc\)$/)
    // The last item out of a nested list takes the list with it.
    expect(outline(outdentListItem(out, 'b_bbbb') ?? [])).toBe('b_lst1(b_aaaa b_bbbb b_cccc)')
    expect(indentListItem(start(), 'b_aaaa')).toBeUndefined()
    expect(outdentListItem(start(), 'b_aaaa')).toBeUndefined()
  })

  it('Backspace joins a list item to the one before, and a paragraph to a heading', () => {
    const merged = mergeWithPrevious(start(), 'b_bbbb')
    expect(outline(merged?.document ?? [])).toBe('b_lst1(b_aaaa b_cccc)')
    expect(merged?.offset).toBe(2)
    const heading = [createBlock('core/heading', { content: text('Tit') }, [], 'b_head'), p('b_par1', 'tel')]
    expect(mergeWithPrevious(heading, 'b_par1')?.document[0]?.attrs['content']).toEqual(text('Tittel'))
    // A paragraph never joins a list item.
    expect(mergeWithPrevious([list('b_lst1', item('b_aaaa', 'x')), p('b_par1', 'y')], 'b_par1')).toBeUndefined()
  })
})
