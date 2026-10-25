import type { InjectionKey, ShallowRef } from 'vue'

import type { BlockDocument, Direction, EditorSelection, InlineNode, Place, TextChangeKind } from '@toascribe/blocks'
import { createEditorModel, createInsertable, flatten, locate } from '@toascribe/blocks'

// The editor prototype's state (M0.6): the model from @toascribe/blocks (the block tree and its one history) in a shallowRef, the
// block that has the cursor, and a registry through which each block puts the cursor back where an action or an undo says. The
// blocks talk to it through `useBlockEditorContext()`; none of them keeps document state of its own (a paragraph's TipTap only
// mirrors its block's content).

/** What a block registers so the editor can give it the cursor: at a text position (a paragraph) or on the block. */
export interface BlockFocusHandler {
  focus(offset?: number): void
}

export interface BlockEditor {
  readonly document: Readonly<ShallowRef<BlockDocument>>
  /** The block that has the cursor (its toolbar is shown). */
  readonly selectedId: Readonly<ShallowRef<string | null>>
  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  /** True when the document differs from the one last loaded or saved. */
  readonly dirty: ComputedRef<boolean>
  /** Replaces the document and forgets the history (after loading). */
  load(document: BlockDocument): void
  /** Marks the current document as saved and ends the current group of typing. */
  markSaved(): void
  /** Called by a block when it gets the cursor or the cursor moves in it. */
  select(selection: EditorSelection): void
  registerFocus(id: string, handler: BlockFocusHandler): void
  unregisterFocus(id: string, handler: BlockFocusHandler): void
  /** Puts the cursor in a block once the page has drawn the latest document. */
  focus(selection: EditorSelection | undefined): void
  insertAt(place: Place, type: string): void
  insertAfter(id: string, type: string): void
  replace(id: string, type: string): void
  remove(id: string): void
  move(id: string, direction: Direction): boolean
  setText(id: string, content: readonly InlineNode[], kind: TextChangeKind, before: number, after: number): void
  setAttrs(id: string, attrs: Readonly<Record<string, unknown>>, group?: string): void
  /** Enter in a paragraph: the content before and after the cursor. */
  split(id: string, before: readonly InlineNode[], after: readonly InlineNode[], offset: number): void
  /** Backspace at the start of a paragraph: joins it to the paragraph before, or deletes it when it is empty. */
  backspaceAtStart(id: string, isEmpty: boolean): void
  /** The block before or after `id` in reading order that can take the cursor (for the arrow keys at the edge of a block). */
  neighbour(id: string, direction: Direction): string | null
  addColumn(columnsId: string): void
  removeColumn(columnsId: string): void
  undo(): void
  redo(): void
  seal(): void
}

const KEY: InjectionKey<BlockEditor> = Symbol('block-editor')

export function useBlockEditor(initial: BlockDocument = []): BlockEditor {
  const model = createEditorModel(initial)
  const document = shallowRef<BlockDocument>(model.document)
  const saved = shallowRef<BlockDocument>(model.document)
  const selectedId = shallowRef<string | null>(null)
  // Read by the computed values below, so they follow the model (which is not reactive itself).
  const version = shallowRef(0)
  let selection: EditorSelection = { blockId: null }
  const handlers = new Map<string, BlockFocusHandler>()

  function refresh(after: EditorSelection | undefined): void {
    document.value = model.document
    version.value += 1
    focus(after)
  }

  function focus(target: EditorSelection | undefined): void {
    if (target?.blockId == null) {
      return
    }
    const { blockId, offset } = target
    selection = target
    selectedId.value = blockId
    // After the next render: a block that was just inserted, moved to another list or restored by undo mounts first.
    void nextTick(() => handlers.get(blockId)?.focus(offset))
  }

  const editor: BlockEditor = {
    document,
    selectedId,
    canUndo: computed(() => version.value >= 0 && model.canUndo),
    canRedo: computed(() => version.value >= 0 && model.canRedo),
    dirty: computed(() => document.value !== saved.value),
    load(next) {
      model.load(next)
      saved.value = model.document
      selectedId.value = null
      selection = { blockId: null }
      refresh(undefined)
    },
    markSaved() {
      saved.value = model.document
      model.seal()
    },
    select(next) {
      if (next.blockId !== selection.blockId) {
        // Typing in another block is another step.
        model.seal()
      }
      selection = next
      selectedId.value = next.blockId
    },
    registerFocus(id, handler) {
      handlers.set(id, handler)
    },
    unregisterFocus(id, handler) {
      if (handlers.get(id) === handler) {
        handlers.delete(id)
      }
    },
    focus,
    insertAt(place, type) {
      refresh(model.insert(place, createInsertable(type), selection))
    },
    insertAfter(id, type) {
      const located = locate(model.document, id)
      if (located !== undefined) {
        refresh(
          model.insert({ parentId: located.parentId, index: located.index + 1 }, createInsertable(type), selection),
        )
      }
    },
    replace(id, type) {
      refresh(model.replace(id, createInsertable(type), selection))
    },
    remove(id) {
      refresh(model.remove(id, selection))
    },
    move(id, direction) {
      const after = model.move(id, direction, selection)
      refresh(after)
      return after !== undefined
    },
    setText(id, content, kind, before, after) {
      if (
        model.setText(id, content, {
          kind,
          before: { blockId: id, offset: before },
          after: { blockId: id, offset: after },
        })
      ) {
        selection = { blockId: id, offset: after }
        document.value = model.document
        version.value += 1
      }
    },
    setAttrs(id, attrs, group) {
      if (model.setAttrs(id, attrs, selection, group)) {
        document.value = model.document
        version.value += 1
      }
    },
    split(id, before, after, offset) {
      refresh(model.split(id, before, after, { blockId: id, offset }))
    },
    backspaceAtStart(id, isEmpty) {
      const cursor = { blockId: id, offset: 0 }
      const merged = model.merge(id, cursor)
      if (merged !== undefined) {
        refresh(merged)
        return
      }
      if (isEmpty) {
        const target = editor.neighbour(id, 'up')
        const removed = model.remove(id, cursor)
        // The cursor goes to the end of the block before (the model's default is its start).
        refresh(
          removed === undefined ? undefined : { blockId: target ?? removed.blockId, offset: Number.MAX_SAFE_INTEGER },
        )
      }
    },
    neighbour(id, direction) {
      const leaves = flatten(model.document).filter(
        (block) => block.children.length === 0 && block.type !== 'core/column',
      )
      const index = leaves.findIndex((block) => block.id === id)
      const next = index === -1 ? undefined : leaves[index + (direction === 'up' ? -1 : 1)]
      return next?.id ?? null
    },
    addColumn(columnsId) {
      refresh(model.addColumn(columnsId, selection))
    },
    removeColumn(columnsId) {
      refresh(model.removeColumn(columnsId, selection))
    },
    undo() {
      refresh(model.undo()?.selection)
    },
    redo() {
      refresh(model.redo()?.selection)
    },
    seal() {
      model.seal()
    },
  }
  return editor
}

export function provideBlockEditor(editor: BlockEditor): void {
  provide(KEY, editor)
}

export function useBlockEditorContext(): BlockEditor {
  const editor = inject(KEY)
  if (editor === undefined) {
    throw new Error('useBlockEditorContext() outside a block editor')
  }
  return editor
}
