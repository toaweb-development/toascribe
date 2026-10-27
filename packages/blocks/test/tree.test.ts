import { describe, expect, it } from 'vitest'

import type { BlockDocument } from '../src/index.ts'
import {
  flatten,
  insertBlock,
  mergeWithPrevious,
  moveBlock,
  moveBlockTo,
  moveTarget,
  removeBlock,
  splitParagraph,
  updateAttrs,
  validateDocument,
} from '../src/index.ts'
import { col, cols, img, outline, p, text } from './fixtures.ts'

// a, columns(c1(x, y), c2(z)), b
const doc = (): BlockDocument => [
  p('b_aaaa', 'a'),
  cols('b_cols', col('b_col1', p('b_xxxx', 'x'), img('b_yyyy')), col('b_col2', p('b_zzzz', 'z'))),
  p('b_bbbb', 'b'),
]

/** Moves a block step by step and records the outline after each step. */
function walk(document: BlockDocument, id: string, direction: 'up' | 'down', steps: number): string[] {
  const seen: string[] = []
  let current = document
  for (let step = 0; step < steps; step += 1) {
    const next = moveBlock(current, id, direction)
    if (next === undefined) {
      seen.push('(stays)')
      break
    }
    current = next
    seen.push(outline(current))
  }
  return seen
}

describe('insert', () => {
  it('puts a block at a place, and refuses a place that does not take it', () => {
    const start = doc()
    expect(outline(insertBlock(start, { parentId: null, index: 1 }, p('b_new1')) ?? [])).toBe(
      'b_aaaa b_new1 b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz)) b_bbbb',
    )
    expect(outline(insertBlock(start, { parentId: 'b_col2', index: 1 }, img('b_new2')) ?? [])).toBe(
      'b_aaaa b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz b_new2)) b_bbbb',
    )
    expect(insertBlock(start, { parentId: 'b_cols', index: 0 }, p('b_new3'))).toBeUndefined()
    expect(insertBlock(start, { parentId: 'b_col1', index: 0 }, col('b_new4'))).toBeUndefined()
    expect(insertBlock(start, { parentId: null, index: 9 }, p('b_new7'))).toBeUndefined()
    expect(insertBlock(start, { parentId: 'b_none', index: 0 }, p('b_new8'))).toBeUndefined()
  })

  it('stops at four columns', () => {
    let current: BlockDocument | undefined = doc()
    current = insertBlock(current, { parentId: 'b_cols', index: 2 }, col('b_col3'))
    current = insertBlock(current ?? [], { parentId: 'b_cols', index: 3 }, col('b_col4'))
    expect(current).toBeDefined()
    expect(insertBlock(current ?? [], { parentId: 'b_cols', index: 4 }, col('b_col5'))).toBeUndefined()
  })

  it('shares every block that did not change', () => {
    const start = doc()
    const next = updateAttrs(start, 'b_zzzz', { content: text('zz') }) ?? []
    expect(next[0]).toBe(start[0])
    expect(next[2]).toBe(start[2])
    expect(next[1]?.children[0]).toBe(start[1]?.children[0])
    expect(next[1]?.children[1]).not.toBe(start[1]?.children[1])
    expect(start[1]?.children[1]?.children[0]?.attrs['content']).toEqual(text('z'))
  })
})

describe('remove', () => {
  it('removes a block with everything in it, and keeps two columns', () => {
    expect(outline(removeBlock(doc(), 'b_yyyy') ?? [])).toBe('b_aaaa b_cols(b_col1(b_xxxx) b_col2(b_zzzz)) b_bbbb')
    expect(outline(removeBlock(doc(), 'b_cols') ?? [])).toBe('b_aaaa b_bbbb')
    expect(removeBlock(doc(), 'b_col1')).toBeUndefined()
    expect(removeBlock(doc(), 'b_none')).toBeUndefined()
  })
})

describe('move up and down, also into and out of columns', () => {
  it('moves a paragraph down into the first column, through the columns and out again', () => {
    expect(walk(doc(), 'b_aaaa', 'down', 6)).toEqual([
      'b_cols(b_col1(b_aaaa b_xxxx b_yyyy) b_col2(b_zzzz)) b_bbbb',
      'b_cols(b_col1(b_xxxx b_aaaa b_yyyy) b_col2(b_zzzz)) b_bbbb',
      'b_cols(b_col1(b_xxxx b_yyyy b_aaaa) b_col2(b_zzzz)) b_bbbb',
      'b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_aaaa b_zzzz)) b_bbbb',
      'b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz b_aaaa)) b_bbbb',
      'b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz)) b_aaaa b_bbbb',
    ])
  })

  it('moves a paragraph up into the last column and out at the top', () => {
    expect(walk(doc(), 'b_bbbb', 'up', 7)).toEqual([
      'b_aaaa b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz b_bbbb))',
      'b_aaaa b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_bbbb b_zzzz))',
      'b_aaaa b_cols(b_col1(b_xxxx b_yyyy b_bbbb) b_col2(b_zzzz))',
      'b_aaaa b_cols(b_col1(b_xxxx b_bbbb b_yyyy) b_col2(b_zzzz))',
      'b_aaaa b_cols(b_col1(b_bbbb b_xxxx b_yyyy) b_col2(b_zzzz))',
      'b_aaaa b_bbbb b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz))',
      'b_bbbb b_aaaa b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz))',
    ])
    expect(moveBlock([p('b_only')], 'b_only', 'up')).toBeUndefined()
  })

  it('moves the columns block past its neighbours as a whole, never into a column', () => {
    expect(walk(doc(), 'b_cols', 'up', 2)).toEqual([
      'b_cols(b_col1(b_xxxx b_yyyy) b_col2(b_zzzz)) b_aaaa b_bbbb',
      '(stays)',
    ])
  })

  it('moves a column only among its columns', () => {
    expect(walk(doc(), 'b_col1', 'down', 2)).toEqual([
      'b_aaaa b_cols(b_col2(b_zzzz) b_col1(b_xxxx b_yyyy)) b_bbbb',
      '(stays)',
    ])
    expect(moveTarget(doc(), 'b_col1', 'up')).toBeUndefined()
  })

  it('every step keeps a valid document', () => {
    let current = doc()
    for (const id of ['b_aaaa', 'b_yyyy', 'b_bbbb', 'b_zzzz']) {
      for (const direction of ['up', 'down', 'down', 'up', 'up'] as const) {
        current = moveBlock(current, id, direction) ?? current
        expect(validateDocument(JSON.parse(JSON.stringify(current))).ok).toBe(true)
      }
    }
    expect(flatten(current)).toHaveLength(flatten(doc()).length)
  })

  it('refuses to move a block into itself or a block it holds', () => {
    expect(moveBlockTo(doc(), 'b_cols', { parentId: 'b_col1', index: 0 })).toBeUndefined()
    expect(moveBlockTo(doc(), 'b_col1', { parentId: 'b_col1', index: 0 })).toBeUndefined()
  })

  it('does not take a columns block below two columns by moving a column out', () => {
    const three = insertBlock(doc(), { parentId: 'b_cols', index: 2 }, col('b_col3')) ?? []
    const other = insertBlock(three, { parentId: null, index: 3 }, cols('b_cl2b', col('b_col5'), col('b_col6'))) ?? []
    expect(moveBlockTo(other, 'b_col1', { parentId: 'b_cl2b', index: 0 })).toBeDefined()
    expect(moveBlockTo(doc(), 'b_col1', { parentId: 'b_cl2b', index: 0 })).toBeUndefined()
  })
})

describe('split and merge paragraphs', () => {
  it('splits a paragraph at the cursor and joins it back', () => {
    const start = [p('b_aaaa', 'Hei du'), p('b_bbbb', 'b')]
    const split = splitParagraph(start, 'b_aaaa', text('Hei '), text('du'), p('b_new1', 'du'))
    expect(split?.newId).toBe('b_new1')
    expect(outline(split?.document ?? [])).toBe('b_aaaa b_new1 b_bbbb')
    expect(split?.document[0]?.attrs['content']).toEqual(text('Hei '))

    const merged = mergeWithPrevious(split?.document ?? [], 'b_new1')
    expect(merged).toMatchObject({ targetId: 'b_aaaa', offset: 4 })
    expect(merged?.document[0]?.attrs['content']).toEqual(text('Hei du'))
    expect(outline(merged?.document ?? [])).toBe('b_aaaa b_bbbb')
  })

  it('does not merge into an image or across a column', () => {
    expect(mergeWithPrevious([img('b_iiii'), p('b_aaaa')], 'b_aaaa')).toBeUndefined()
    expect(mergeWithPrevious(doc(), 'b_xxxx')).toBeUndefined()
    expect(mergeWithPrevious(doc(), 'b_zzzz')).toBeUndefined()
  })
})
