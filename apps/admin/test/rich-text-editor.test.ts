import { getSchema } from '@tiptap/core'
import { toggleMark } from '@tiptap/pm/commands'
import { Node as PmNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import type { BlockDocument, InlineNode } from '@toascribe/blocks'
import { createBlock, createEditorModel, findBlock } from '@toascribe/blocks'

import { changeKind, fromEditorDoc, richTextExtensions, toEditorDoc } from '../app/utils/rich-text-editor.ts'

// The editor model's one history with TipTap's own formatting: the same extensions and schema as a paragraph in the editor, with
// marks applied by ProseMirror's commands (as TipTap's Bold, Italic and Link do), the change read back as the editor does it, and
// recorded in the model. No DOM: ProseMirror's state and commands work without a view.

const schema = getSchema(richTextExtensions())

function stateOf(content: readonly InlineNode[]): EditorState {
  return EditorState.create({ schema, doc: PmNode.fromJSON(schema, toEditorDoc(content)) })
}

/** Runs a command on a selection and returns the transaction it dispatched. */
function run(
  state: EditorState,
  from: number,
  to: number,
  command: (s: EditorState, dispatch: (tr: Transaction) => void) => boolean,
): Transaction {
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  let dispatched: Transaction | undefined
  expect(command(selected, (tr) => (dispatched = tr))).toBe(true)
  if (dispatched === undefined) throw new Error('no transaction')
  return dispatched
}

const text = (value: string): InlineNode[] => [{ type: 'text', text: value }]
const start = (): BlockDocument => [createBlock('core/paragraph', { content: text('Hei fet tekst') }, [], 'b_para')]
const contentAt = (document: BlockDocument) => findBlock(document, 'b_para')?.attrs['content']

describe('TipTap formatting in the one history', () => {
  it('a mark is a format step, and undo and redo give back the text before and after it', () => {
    const model = createEditorModel(start())
    const state = stateOf(text('Hei fet tekst'))
    // Positions start at 1 inside the paragraph: «fet» is 5 to 8.
    const transaction = run(state, 5, 8, toggleMark(schema.marks['bold']!))
    expect(changeKind(transaction)).toBe('format')
    const bold = fromEditorDoc(transaction.doc.toJSON())
    expect(bold).toEqual([
      { type: 'text', text: 'Hei ' },
      { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' tekst' },
    ])
    model.setText('b_para', bold, {
      kind: 'format',
      before: { blockId: 'b_para', offset: 7 },
      after: { blockId: 'b_para', offset: 7 },
    })

    expect(contentAt(model.undo()?.state ?? [])).toEqual(text('Hei fet tekst'))
    expect(contentAt(model.redo()?.state ?? [])).toEqual(bold)
  })

  it('typing is a text step; typing, bold, italic and a link undo one at a time across a move of the block', () => {
    let time = 0
    const document = [...start(), createBlock('core/paragraph', { content: text('Annet') }, [], 'b_other')]
    const model = createEditorModel(document, { now: () => time })
    let state = stateOf(text('Hei fet tekst'))

    const typed = state.tr.insertText('!', state.doc.content.size - 1)
    expect(changeKind(typed)).toBe('text')
    state = state.apply(typed)
    time += 100
    model.setText('b_para', fromEditorDoc(state.doc.toJSON()), {
      kind: 'text',
      before: { blockId: 'b_para', offset: 13 },
      after: { blockId: 'b_para', offset: 14 },
    })

    const steps: [string, Transaction][] = [['bold', run(state, 5, 8, toggleMark(schema.marks['bold']!))]]
    state = state.apply(steps[0]![1])
    steps.push(['italic', run(state, 1, 4, toggleMark(schema.marks['italic']!))])
    state = state.apply(steps[1]![1])
    steps.push(['link', run(state, 9, 14, toggleMark(schema.marks['link']!, { href: 'https://example.com/' }))])
    for (const [, transaction] of steps) {
      expect(changeKind(transaction)).toBe('format')
    }
    // Recorded in order, each as the editor reads TipTap's document after it.
    let replay = stateOf(text('Hei fet tekst!'))
    for (const [, transaction] of steps) {
      replay = replay.apply(transaction)
      model.setText('b_para', fromEditorDoc(replay.doc.toJSON()), {
        kind: 'format',
        before: { blockId: 'b_para' },
        after: { blockId: 'b_para' },
      })
    }
    const formatted = contentAt(model.document)
    expect(formatted).toEqual([
      { type: 'text', text: 'Hei', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'tekst', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
      { type: 'text', text: '!' },
    ])
    model.move('b_para', 'down', { blockId: 'b_para' })
    expect(model.document[1]?.id).toBe('b_para')

    expect(model.undo()?.state[0]?.id).toBe('b_para') // the move
    // The link: the runs without marks join again, as ProseMirror writes them.
    expect(contentAt(model.undo()?.state ?? [])).toEqual([
      { type: 'text', text: 'Hei', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'fet', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' tekst!' },
    ])
    model.undo() // the italic
    model.undo() // the bold
    expect(contentAt(model.document)).toEqual(text('Hei fet tekst!'))
    expect(contentAt(model.undo()?.state ?? [])).toEqual(text('Hei fet tekst')) // the typing
    expect(model.canUndo).toBe(false)
    for (let step = 0; step < 5; step += 1) model.redo()
    expect(model.document[1]?.id).toBe('b_para')
    expect(contentAt(model.document)).toEqual(formatted)
  })

  it('reads a TipTap link with target and rel back as the stored href only, and drops a script link', () => {
    const state = stateOf(text('lenke'))
    const linked = state.apply(
      run(state, 1, 6, toggleMark(schema.marks['link']!, { href: 'https://example.com/', target: '_blank' })),
    )
    expect(fromEditorDoc(linked.doc.toJSON())).toEqual([
      { type: 'text', text: 'lenke', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
    ])
    const evil = state.apply(run(state, 1, 6, toggleMark(schema.marks['link']!, { href: 'javascript:alert(1)' })))
    expect(fromEditorDoc(evil.doc.toJSON())).toEqual(text('lenke'))
  })
})
