// The editor's model (M0.6): a block document and its one history. Every user action is a method here, and each method makes one
// change through tree.ts and records it with where the cursor was before and is after. The Vue editor wraps this in a shallowRef;
// the TipTap instances report their text changes to `setText` and never undo anything themselves. Undo and redo hand back the
// selection to restore, so the editor can put the cursor back in the right block at the right place.
import type { Block, BlockDocument } from './block.ts'
import { createBlock, createColumn } from './block.ts'
import type { HistoryOptions, HistoryRestore } from './history.ts'
import { createHistory } from './history.ts'
import type { InlineNode } from './inline.ts'
import { COLUMN, COLUMNS } from './registry.ts'
import type { Direction, Place } from './tree.ts'
import {
  childrenOf,
  findBlock,
  flatten,
  insertBlock,
  locate,
  mergeWithPrevious,
  moveBlock,
  indentListItem,
  insertBlocks,
  outdentListItem,
  removeBlock,
  removeBlocks,
  splitText,
  updateAttrs,
} from './tree.ts'

/** Where the cursor is: a block, and inside a text block the position in its text (as TipTap counts it, from 0). */
export interface EditorSelection {
  readonly blockId: string | null
  readonly offset?: number
}

/** How a text change came about: `text` (typing, grouped into steps) or `format` (a mark, always a step of its own). */
export type TextChangeKind = 'text' | 'format'

export interface EditorModel {
  readonly document: BlockDocument
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoDepth: number
  /** Replaces the document without a step (after loading): the history starts empty. */
  load(document: BlockDocument): void
  /** Ends a group of typing (a click elsewhere, a save), so the next keystroke starts a new step. */
  seal(): void
  insert(place: Place, block: Block, before: EditorSelection): EditorSelection | undefined
  remove(id: string, before: EditorSelection): EditorSelection | undefined
  /** Puts `block` where `id` stands, in one step (the «/» menu turns an empty paragraph into the chosen block). */
  replace(id: string, block: Block, before: EditorSelection): EditorSelection | undefined
  move(id: string, direction: Direction, before: EditorSelection): EditorSelection | undefined
  setText(
    id: string,
    content: readonly InlineNode[],
    change: { kind: TextChangeKind; before: EditorSelection; after: EditorSelection },
  ): boolean
  /** Other attributes (an image's address, alt text, caption). Typing in one field of one block is grouped like text. */
  setAttrs(id: string, attrs: Readonly<Record<string, unknown>>, before: EditorSelection, group?: string): boolean
  split(
    id: string,
    before: readonly InlineNode[],
    after: readonly InlineNode[],
    cursor: EditorSelection,
  ): EditorSelection | undefined
  merge(id: string, cursor: EditorSelection): EditorSelection | undefined
  /** Tab / Shift+Tab in a list item. */
  indent(id: string, cursor: EditorSelection): EditorSelection | undefined
  outdent(id: string, cursor: EditorSelection): EditorSelection | undefined
  /** Several blocks out in one step (a multi-block selection deleted or cut). */
  removeMany(ids: readonly string[], before: EditorSelection): EditorSelection | undefined
  /** Several blocks in at a place in one step (a paste); the cursor goes to the last one. */
  insertMany(place: Place, blocks: readonly Block[], before: EditorSelection): EditorSelection | undefined
  /** Turns a text block into another (paragraph ↔ heading), keeping its text, in one step. */
  transform(
    id: string,
    type: string,
    attrs: Readonly<Record<string, unknown>>,
    before: EditorSelection,
  ): EditorSelection | undefined
  addColumn(columnsId: string, before: EditorSelection): EditorSelection | undefined
  removeColumn(columnsId: string, before: EditorSelection): EditorSelection | undefined
  undo(): HistoryRestore<BlockDocument, EditorSelection> | undefined
  redo(): HistoryRestore<BlockDocument, EditorSelection> | undefined
}

/** The block that takes the focus when `id` goes away: the one before it in document order that is not inside it, else the one after. */
export function neighbourAfterRemoval(document: BlockDocument, id: string): string | null {
  const order = flatten(document)
  const removed = findBlock(document, id)
  if (removed === undefined) {
    return null
  }
  const inside = new Set(flatten([removed]).map((block) => block.id))
  const index = order.findIndex((block) => block.id === id)
  const isLeaf = (block: Block) => !inside.has(block.id) && block.children.length === 0
  const previous = order.slice(0, index).reverse().find(isLeaf)
  return (previous ?? order.slice(index + 1).find(isLeaf))?.id ?? null
}

/** The block that takes the cursor in a new block: the block itself, or for columns the first block of the first column. */
function firstLeaf(block: Block): Block {
  return block.type === COLUMNS
    ? (flatten([block]).find((inner) => inner.children.length === 0 && inner.type !== COLUMN) ?? block)
    : block
}

/** The block that takes the cursor at the end of something put in: its last leaf. */
function lastLeaf(block: Block): Block {
  const leaves = flatten([block]).filter((inner) => inner.children.length === 0)
  return leaves.at(-1) ?? block
}

export function createEditorModel(initial: BlockDocument, options: HistoryOptions = {}): EditorModel {
  const history = createHistory<BlockDocument, EditorSelection>(initial, options)

  function commit(
    next: BlockDocument | undefined,
    before: EditorSelection,
    after: EditorSelection,
    group?: string,
  ): EditorSelection | undefined {
    if (next === undefined) {
      return undefined
    }
    history.record(next, { selectionBefore: before, selectionAfter: after, ...(group === undefined ? {} : { group }) })
    return after
  }

  return {
    get document() {
      return history.present
    },
    get canUndo() {
      return history.canUndo
    },
    get canRedo() {
      return history.canRedo
    },
    get undoDepth() {
      return history.undoDepth
    },
    load(document) {
      history.reset(document)
    },
    seal() {
      history.seal()
    },
    insert(place, block, before) {
      return commit(insertBlock(history.present, place, block), before, { blockId: firstLeaf(block).id, offset: 0 })
    },
    remove(id, before) {
      const focus = neighbourAfterRemoval(history.present, id)
      return commit(removeBlock(history.present, id), before, { blockId: focus })
    },
    replace(id, block, before) {
      const located = locate(history.present, id)
      const removed = located === undefined ? undefined : removeBlock(history.present, id)
      const next =
        located === undefined || removed === undefined
          ? undefined
          : insertBlock(removed, { parentId: located.parentId, index: located.index }, block)
      return commit(next, before, { blockId: firstLeaf(block).id, offset: 0 })
    },
    move(id, direction, before) {
      return commit(moveBlock(history.present, id, direction), before, { ...before, blockId: id })
    },
    setText(id, content, change) {
      const next = updateAttrs(history.present, id, { content })
      const group = change.kind === 'text' ? `text:${id}` : undefined
      return commit(next, change.before, change.after, group) !== undefined
    },
    setAttrs(id, attrs, before, group) {
      return commit(updateAttrs(history.present, id, attrs), before, before, group) !== undefined
    },
    split(id, before, after, cursor) {
      const result = splitText(history.present, id, before, after)
      return result === undefined ? undefined : commit(result.document, cursor, { blockId: result.newId, offset: 0 })
    },
    merge(id, cursor) {
      const result = mergeWithPrevious(history.present, id)
      return result === undefined
        ? undefined
        : commit(result.document, cursor, { blockId: result.targetId, offset: result.offset })
    },
    indent(id, cursor) {
      return commit(indentListItem(history.present, id), cursor, cursor)
    },
    outdent(id, cursor) {
      return commit(outdentListItem(history.present, id), cursor, cursor)
    },
    removeMany(ids, before) {
      const first = ids[0]
      const focus =
        first === undefined
          ? null
          : neighbourAfterRemoval(removeBlocks(history.present, ids.slice(1)) ?? history.present, first)
      return commit(removeBlocks(history.present, ids), before, { blockId: focus })
    },
    insertMany(place, blocks, before) {
      const last = blocks.at(-1)
      return last === undefined
        ? undefined
        : commit(insertBlocks(history.present, place, blocks), before, {
            blockId: lastLeaf(last).id,
            offset: Number.MAX_SAFE_INTEGER,
          })
    },
    transform(id, type, attrs, before) {
      const located = locate(history.present, id)
      if (located === undefined) return undefined
      const block = createBlock(type, { ...attrs, content: located.block.attrs['content'] ?? [] }, [], id)
      const removed = removeBlock(history.present, id)
      const next =
        removed === undefined
          ? undefined
          : insertBlock(removed, { parentId: located.parentId, index: located.index }, block)
      return commit(next, before, { ...before, blockId: id })
    },
    addColumn(columnsId, before) {
      const columns = findBlock(history.present, columnsId)
      if (columns?.type !== COLUMNS) {
        return undefined
      }
      const column = createColumn()
      const focus = column.children[0]?.id ?? column.id
      return commit(
        insertBlock(history.present, { parentId: columnsId, index: columns.children.length }, column),
        before,
        { blockId: focus, offset: 0 },
      )
    },
    removeColumn(columnsId, before) {
      const last = childrenOf(history.present, columnsId)?.at(-1)
      if (last?.type !== COLUMN || locate(history.present, last.id)?.parentId !== columnsId) {
        return undefined
      }
      const next = removeBlock(history.present, last.id)
      return commit(next, before, { blockId: columnsId })
    },
    undo() {
      return history.undo()
    },
    redo() {
      return history.redo()
    },
  }
}
