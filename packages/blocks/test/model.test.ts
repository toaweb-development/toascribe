import { describe, expect, it } from 'vitest'

import type { BlockDocument, EditorModel, EditorSelection } from '../src/index.ts'
import { createEditorModel, findBlock } from '../src/index.ts'
import { col, cols, img, outline, p, text } from './fixtures.ts'

const start = (): BlockDocument => [
  p('b_aaaa', 'a'),
  cols('b_cols', col('b_col1', p('b_xxxx', 'x')), col('b_col2', p('b_zzzz', 'z'))),
  img('b_iiii'),
]

const sel = (blockId: string, offset?: number): EditorSelection =>
  offset === undefined ? { blockId } : { blockId, offset }

/** Runs an action, then checks that undo gives back the document before it and redo the document after it, with the cursors. */
function roundTrip(model: EditorModel, action: () => unknown) {
  const before = model.document
  const depth = model.undoDepth
  action()
  const after = model.document
  expect(after).not.toBe(before)
  expect(model.undoDepth).toBe(depth + 1)
  const undone = model.undo()
  expect(undone?.state).toBe(before)
  expect(model.document).toBe(before)
  const redone = model.redo()
  expect(redone?.state).toBe(after)
  return { undone, redone }
}

describe('the editor model: one history over every action', () => {
  it('insert', () => {
    const model = createEditorModel(start())
    const { undone, redone } = roundTrip(model, () =>
      model.insert({ parentId: 'b_col2', index: 1 }, p('b_new1', 'n'), sel('b_zzzz', 1)),
    )
    expect(outline(model.document)).toBe('b_aaaa b_cols(b_col1(b_xxxx) b_col2(b_zzzz b_new1)) b_iiii')
    expect(undone?.selection).toEqual(sel('b_zzzz', 1))
    expect(redone?.selection).toEqual(sel('b_new1', 0))
  })

  it('insert of columns puts the cursor in the first column', () => {
    const model = createEditorModel([])
    const after = model.insert(
      { parentId: null, index: 0 },
      cols('b_cols', col('b_c1', p('b_p1')), col('b_c2', p('b_p2'))),
      sel('x'),
    )
    expect(after).toEqual(sel('b_p1', 0))
  })

  it('remove, with the cursor going to the block before', () => {
    const model = createEditorModel(start())
    const { undone, redone } = roundTrip(model, () => model.remove('b_zzzz', sel('b_zzzz', 0)))
    expect(redone?.selection).toEqual(sel('b_xxxx'))
    expect(undone?.selection).toEqual(sel('b_zzzz', 0))
    expect(model.remove('b_aaaa', sel('b_aaaa'))).toEqual(sel('b_xxxx'))
  })

  it('replace, in one step (the «/» menu)', () => {
    const model = createEditorModel(start())
    const { undone, redone } = roundTrip(model, () => model.replace('b_zzzz', img('b_new2'), sel('b_zzzz', 3)))
    expect(outline(model.document)).toBe('b_aaaa b_cols(b_col1(b_xxxx) b_col2(b_new2)) b_iiii')
    expect(undone?.selection).toEqual(sel('b_zzzz', 3))
    expect(redone?.selection).toEqual(sel('b_new2', 0))
    expect(model.replace('b_xxxx', col('b_bad1'), sel('b_xxxx'))).toBeUndefined()
  })

  it('move, into a column and out of it, one step each', () => {
    const model = createEditorModel(start())
    roundTrip(model, () => model.move('b_aaaa', 'down', sel('b_aaaa', 1)))
    expect(outline(model.document)).toBe('b_cols(b_col1(b_aaaa b_xxxx) b_col2(b_zzzz)) b_iiii')
    roundTrip(model, () => model.move('b_iiii', 'up', sel('b_iiii')))
    expect(outline(model.document)).toBe('b_cols(b_col1(b_aaaa b_xxxx) b_col2(b_zzzz b_iiii))')
    expect(model.move('b_cols', 'up', sel('b_cols'))).toBeUndefined()
    expect(model.undoDepth).toBe(2)
  })

  it('typing, grouped, and formatting as a step of its own', () => {
    let time = 0
    const model = createEditorModel(start(), { now: () => time })
    const type = (value: string) => {
      time += 100
      model.setText('b_aaaa', text(value), {
        kind: 'text',
        before: sel('b_aaaa', value.length - 1),
        after: sel('b_aaaa', value.length),
      })
    }
    type('ab')
    type('abc')
    type('abcd')
    expect(model.undoDepth).toBe(1)
    const bold = [
      { type: 'text' as const, text: 'ab' },
      { type: 'text' as const, text: 'cd', marks: [{ type: 'bold' as const }] },
    ]
    model.setText('b_aaaa', bold, { kind: 'format', before: sel('b_aaaa', 4), after: sel('b_aaaa', 4) })
    type('abcde') // a new step: formatting ended the group
    expect(model.undoDepth).toBe(3)

    expect(model.undo()?.state[0]?.attrs['content']).toEqual(bold)
    expect(model.undo()?.state[0]?.attrs['content']).toEqual(text('abcd'))
    expect(model.undo()?.state[0]?.attrs['content']).toEqual(text('a'))
    expect(model.redo()?.state[0]?.attrs['content']).toEqual(text('abcd'))
    expect(model.redo()?.state[0]?.attrs['content']).toEqual(bold)
  })

  it('split and merge', () => {
    const model = createEditorModel([p('b_aaaa', 'Hei du')])
    const { redone } = roundTrip(model, () => model.split('b_aaaa', text('Hei '), text('du'), sel('b_aaaa', 4)))
    const newId = redone?.selection.blockId ?? ''
    expect(model.document.map((block) => block.attrs['content'])).toEqual([text('Hei '), text('du')])
    const merged = roundTrip(model, () => model.merge(newId, sel(newId, 0)))
    expect(merged.redone?.selection).toEqual(sel('b_aaaa', 4))
    expect(model.document).toHaveLength(1)
  })

  it('image attributes, typing in a field grouped', () => {
    let time = 0
    const model = createEditorModel(start(), { now: () => time })
    for (const alt of ['E', 'Et', 'Et b']) {
      time += 100
      model.setAttrs('b_iiii', { alt }, sel('b_iiii'), 'alt:b_iiii')
    }
    expect(model.undoDepth).toBe(1)
    expect(model.undo()?.state[2]?.attrs['alt']).toBe('An image')
  })

  it('add and remove a column, between two and four', () => {
    const model = createEditorModel(start())
    roundTrip(model, () => model.addColumn('b_cols', sel('b_cols')))
    model.addColumn('b_cols', sel('b_cols'))
    expect(model.addColumn('b_cols', sel('b_cols'))).toBeUndefined()
    expect(findBlock(model.document, 'b_cols')?.children).toHaveLength(4)
    roundTrip(model, () => model.removeColumn('b_cols', sel('b_cols')))
    model.removeColumn('b_cols', sel('b_cols'))
    expect(model.removeColumn('b_cols', sel('b_cols'))).toBeUndefined()
    expect(findBlock(model.document, 'b_cols')?.children).toHaveLength(2)
  })

  it('undo three times and redo twice across typing, formatting, inserting, moving and deleting', () => {
    let time = 0
    const model = createEditorModel(start(), { now: () => time })
    const states: BlockDocument[] = [model.document]
    time += 100
    model.setText('b_xxxx', text('xy'), { kind: 'text', before: sel('b_xxxx', 1), after: sel('b_xxxx', 2) })
    states.push(model.document)
    model.setText('b_xxxx', text('xy', [{ type: 'italic' }]), {
      kind: 'format',
      before: sel('b_xxxx', 2),
      after: sel('b_xxxx', 2),
    })
    states.push(model.document)
    model.insert({ parentId: null, index: 0 }, p('b_new1'), sel('b_xxxx', 2))
    states.push(model.document)
    model.move('b_new1', 'down', sel('b_new1', 0))
    states.push(model.document)
    model.remove('b_iiii', sel('b_iiii'))
    states.push(model.document)

    model.undo()
    model.undo()
    model.undo()
    expect(model.document).toBe(states[2])
    model.redo()
    model.redo()
    expect(model.document).toBe(states[4])
    expect(outline(model.document)).toBe('b_aaaa b_new1 b_cols(b_col1(b_xxxx) b_col2(b_zzzz)) b_iiii')
    expect(findBlock(model.document, 'b_xxxx')?.attrs['content']).toEqual(text('xy', [{ type: 'italic' }]))
  })
})
