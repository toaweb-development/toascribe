import type { InjectionKey, ShallowRef } from 'vue'

import type { Block, BlockDocument, Direction, EditorSelection, InlineNode, Place } from '@toascribe/blocks'
import {
  BLOCKS_MIME,
  allowedInContentType,
  blocksToText,
  canContain,
  createEditorModel,
  createInsertable,
  findBlock,
  flatten,
  getBlockDefinition,
  isTextBlock,
  locate,
  mayEditBlockType,
  parseClipboardBlocks,
  selectionEnds,
  serializeBlocks,
  siblingRange,
  textToBlocks,
} from '@toascribe/blocks'

// The editor's state (M0.6, M1.3): the model from @toascribe/blocks (the block tree and its one history) in a shallowRef, the block
// that has the cursor or the blocks of a selection over several (Shift+click, Shift+arrow), and a registry through which each block
// puts the cursor back where an action or an undo says. The blocks talk to it through `useBlockEditorContext()`; none of them keeps
// document state of its own (a text block's TipTap only mirrors its block's content).
//
// Each block's component is drawn once, in a flat list, into a «dock»: an element that belongs to the block for as long as it exists.
// The tree only draws empty slots where the blocks stand, and a slot moves the block's dock into itself. A block that moves to another
// parent therefore keeps its component and its TipTap instance (decision note 0001, adjustment 2); only its dock changes place.

/** What a block registers so the editor can give it the cursor: at a text position (a text block) or on the block. */
export interface BlockFocusHandler {
  focus(offset?: number): void
}

/** What the editor needs to know about the account: the capabilities (custom HTML) and the content type («Les mer» in posts). */
export interface BlockEditorScope {
  readonly capabilities: ReadonlySet<string>
  readonly contentType: string
}

export interface BlockEditor {
  readonly document: Readonly<ShallowRef<BlockDocument>>
  /** The block that has the cursor (its toolbar is shown), or the last block of a selection over several. */
  readonly selectedId: Readonly<ShallowRef<string | null>>
  /** The blocks of a selection over several, in document order; empty when one block (or none) is selected. */
  readonly multi: Readonly<ShallowRef<readonly string[]>>
  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  /** True when the document differs from the one last loaded or saved. */
  readonly dirty: ComputedRef<boolean>
  readonly scope: Readonly<ShallowRef<BlockEditorScope>>
  setScope(scope: BlockEditorScope): void
  /** Replaces the document and forgets the history (after loading). */
  load(document: BlockDocument): void
  /** Marks `sent` (the document the save sent) as saved: edits made while the save was under way stay unsaved. */
  markSaved(sent: BlockDocument): void
  /** Called by a block when it gets the cursor or the cursor moves in it. Ends a selection over several blocks. */
  select(selection: EditorSelection): void
  /** Shift+click or Shift+arrow: a selection from the selected block (or the start of the current selection) to `id`. */
  extendSelection(id: string): void
  /** Shift+arrow past the edge of the selection: one more sibling before or after it. */
  extendSelectionBy(direction: Direction): void
  clearMulti(): void
  registerFocus(id: string, handler: BlockFocusHandler): void
  unregisterFocus(id: string, handler: BlockFocusHandler): void
  /** Puts the cursor in a block once the page has drawn the latest document. */
  focus(selection: EditorSelection | undefined): void
  /** The element a block's component is drawn into (client only). */
  dock(id: string): HTMLElement
  insertAt(place: Place, type: string): void
  insertAfter(id: string, type: string): void
  insertBefore(id: string, type: string): void
  replace(id: string, type: string): void
  /** Turns a text block into another kind (paragraph ↔ heading), keeping its text. */
  transform(id: string, type: string, attrs?: Readonly<Record<string, unknown>>): void
  remove(id: string): void
  /** Deletes the blocks of the selection over several, in one step. */
  removeSelected(): void
  move(id: string, direction: Direction): boolean
  setText(
    id: string,
    content: readonly InlineNode[],
    kind: 'text' | 'format',
    before: number,
    after: number,
    key?: string,
  ): void
  setAttrs(id: string, attrs: Readonly<Record<string, unknown>>, group?: string): void
  /** Enter in a text block: the content before and after the cursor. */
  split(id: string, before: readonly InlineNode[], after: readonly InlineNode[], offset: number): void
  /** Enter in an empty list item: out of a nested list, or out of the list into a paragraph. */
  enterOnEmptyItem(id: string): void
  /** Backspace at the start of a text block: joins it to the block before, or deletes it when it is empty. */
  backspaceAtStart(id: string, isEmpty: boolean): void
  indent(id: string): boolean
  outdent(id: string): boolean
  /** The block before or after `id` in reading order that can take the cursor (for the arrow keys at the edge of a block). */
  neighbour(id: string, direction: Direction): string | null
  addColumn(columnsId: string): void
  removeColumn(columnsId: string): void
  /** Puts blocks in at a place, in one step (a gallery's images, a table's rows are attributes, not this). */
  insertBlocks(place: Place, blocks: readonly Block[]): boolean
  /** The selection over several blocks (or the selected block) for the clipboard; undefined when there is nothing to copy. */
  copyPayload(): { json: string; text: string } | undefined
  /**
   * A paste at the selected block: blocks (from the clipboard's JSON) or plain text of several paragraphs go in after it, into the
   * same parent where it takes them, else after the nearest ancestor that does. Returns false when there is nothing for the editor to
   * do (a single line of text, which the text block takes itself).
   */
  paste(data: { json?: string; text?: string }): boolean
  undo(): void
  redo(): void
  seal(): void
}

const KEY: InjectionKey<BlockEditor> = Symbol('block-editor')

/** Blocks that the cursor can stand in: text blocks, and blocks without children of their own (an image, a separator). */
function focusable(block: Block): boolean {
  if (isTextBlock(block.type)) return true
  return (getBlockDefinition(block.type)?.allowedBlocks.length ?? 0) === 0
}

export function useBlockEditor(initial: BlockDocument = []): BlockEditor {
  const model = createEditorModel(initial)
  const document = shallowRef<BlockDocument>(model.document)
  const saved = shallowRef<BlockDocument>(model.document)
  const selectedId = shallowRef<string | null>(null)
  const multi = shallowRef<readonly string[]>([])
  const scope = shallowRef<BlockEditorScope>({ capabilities: new Set(), contentType: 'post' })
  // Read by the computed values below, so they follow the model (which is not reactive itself).
  const version = shallowRef(0)
  let selection: EditorSelection = { blockId: null }
  /** Where a selection over several blocks started (Shift+click is measured from here). */
  let anchor: string | null = null
  const handlers = new Map<string, BlockFocusHandler>()
  const docks = new Map<string, HTMLElement>()

  function refresh(after: EditorSelection | undefined): void {
    document.value = model.document
    version.value += 1
    // Docks of blocks that are gone are dropped (an undo that brings a block back gets a new one).
    for (const id of docks.keys()) if (findBlock(model.document, id) === undefined) docks.delete(id)
    focus(after)
  }

  function focus(target: EditorSelection | undefined): void {
    if (target?.blockId == null) {
      return
    }
    const { blockId, offset } = target
    selection = target
    selectedId.value = blockId
    multi.value = []
    anchor = blockId
    // After the next render: a block that was just inserted, moved to another list or restored by undo is in its slot first.
    void nextTick(() => handlers.get(blockId)?.focus(offset))
  }

  /** The place a paste or an insert after `id` goes: after it where its parent takes the blocks, else after an ancestor that does. */
  function placeAfter(id: string, types: readonly string[]): { place: Place; parentType: string | null } | undefined {
    for (let at = locate(model.document, id); at !== undefined;) {
      const parentType = at.parentType
      if (types.every((type) => canContain(parentType, type))) {
        return { place: { parentId: at.parentId, index: at.index + 1 }, parentType }
      }
      at = at.parentId === null ? undefined : locate(model.document, at.parentId)
    }
    return undefined
  }

  function setMulti(ids: readonly string[]): void {
    multi.value = ids.length > 1 ? ids : []
    const last = ids.at(-1)
    if (last !== undefined) {
      selectedId.value = last
      selection = { blockId: last }
    }
    if (ids.length > 1) {
      // The text has no cursor while blocks are selected: the canvas takes the keys (Delete, Ctrl+C, Escape).
      ;(globalThis.document.activeElement as HTMLElement | null)?.blur()
      globalThis.document.querySelector<HTMLElement>('[data-editor-canvas]')?.focus()
    }
  }

  function mayInsert(type: string): boolean {
    return mayEditBlockType(type, scope.value.capabilities)
  }

  const editor: BlockEditor = {
    document,
    selectedId,
    multi,
    scope,
    canUndo: computed(() => version.value >= 0 && model.canUndo),
    canRedo: computed(() => version.value >= 0 && model.canRedo),
    dirty: computed(() => document.value !== saved.value),
    setScope(next) {
      scope.value = next
    },
    load(next) {
      model.load(next)
      saved.value = model.document
      selectedId.value = null
      multi.value = []
      selection = { blockId: null }
      refresh(undefined)
    },
    markSaved(sent) {
      saved.value = sent
      model.seal()
    },
    select(next) {
      if (next.blockId !== selection.blockId) {
        // Typing in another block is another step.
        model.seal()
      }
      selection = next
      selectedId.value = next.blockId
      multi.value = []
      anchor = next.blockId
    },
    extendSelection(id) {
      const start = anchor ?? selection.blockId
      if (start === null || start === id) {
        return
      }
      const ends = selectionEnds(model.document, start, id)
      const range = ends === undefined ? undefined : siblingRange(model.document, ends[0], ends[1])
      if (range !== undefined) {
        // In document order, whichever way the selection was made; the anchor stays where it started.
        setMulti(range)
        anchor = start
      }
    },
    extendSelectionBy(direction) {
      const current = multi.value.length > 0 ? multi.value : selection.blockId === null ? [] : [selection.blockId]
      const edge = direction === 'up' ? current[0] : current.at(-1)
      const located = edge === undefined ? undefined : locate(model.document, edge)
      if (located === undefined) return
      const siblings =
        (located.parentId === null ? model.document : findBlock(model.document, located.parentId)?.children) ?? []
      const next = siblings[located.index + (direction === 'up' ? -1 : 1)]
      if (next === undefined) return
      setMulti(direction === 'up' ? [next.id, ...current] : [...current, next.id])
    },
    clearMulti() {
      multi.value = []
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
    dock(id) {
      let element = docks.get(id)
      if (element === undefined) {
        element = globalThis.document.createElement('div')
        element.dataset['dock'] = id
        docks.set(id, element)
      }
      return element
    },
    insertAt(place, type) {
      if (mayInsert(type)) refresh(model.insert(place, createInsertable(type), selection))
    },
    insertAfter(id, type) {
      const target = placeAfter(id, [type])
      if (target !== undefined && mayInsert(type)) {
        refresh(model.insert(target.place, createInsertable(type), selection))
      }
    },
    insertBefore(id, type) {
      const located = locate(model.document, id)
      if (located !== undefined && canContain(located.parentType, type) && mayInsert(type)) {
        refresh(model.insert({ parentId: located.parentId, index: located.index }, createInsertable(type), selection))
      }
    },
    replace(id, type) {
      if (mayInsert(type)) refresh(model.replace(id, createInsertable(type), selection))
    },
    transform(id, type, attrs = {}) {
      refresh(model.transform(id, type, attrs, selection))
    },
    remove(id) {
      refresh(model.remove(id, selection))
    },
    removeSelected() {
      if (multi.value.length > 0) refresh(model.removeMany(multi.value, selection))
    },
    move(id, direction) {
      const after = model.move(id, direction, selection)
      refresh(after)
      return after !== undefined
    },
    setText(id, content, kind, before, after, key = 'content') {
      const changed =
        key === 'content'
          ? model.setText(id, content, {
              kind,
              before: { blockId: id, offset: before },
              after: { blockId: id, offset: after },
            })
          : model.setAttrs(
              id,
              { [key]: content },
              { blockId: id, offset: before },
              kind === 'text' ? `${key}:${id}` : undefined,
            )
      if (changed) {
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
    enterOnEmptyItem(id) {
      const cursor = { blockId: id, offset: 0 }
      refresh(model.outdent(id, cursor) ?? model.endList(id, cursor))
    },
    backspaceAtStart(id, isEmpty) {
      const cursor = { blockId: id, offset: 0 }
      const merged = model.merge(id, cursor)
      if (merged !== undefined) {
        refresh(merged)
        return
      }
      if (!isEmpty) return
      const target = editor.neighbour(id, 'up')
      let removed = model.remove(id, cursor)
      // The only item of a list cannot go on its own (a list keeps one): the list goes with it.
      const located = locate(model.document, id)
      if (removed === undefined && located?.parentId != null) {
        const parent = findBlock(model.document, located.parentId)
        if (parent?.children.length === 1) removed = model.remove(parent.id, cursor)
      }
      // The cursor goes to the end of the block before (the model's default is its start).
      refresh(
        removed === undefined ? undefined : { blockId: target ?? removed.blockId, offset: Number.MAX_SAFE_INTEGER },
      )
    },
    indent(id) {
      const after = model.indent(id, selection)
      refresh(after)
      return after !== undefined
    },
    outdent(id) {
      const after = model.outdent(id, selection)
      refresh(after)
      return after !== undefined
    },
    neighbour(id, direction) {
      const leaves = flatten(model.document).filter(focusable)
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
    insertBlocks(place, blocks) {
      const after = model.insertMany(place, blocks, selection)
      refresh(after)
      return after !== undefined
    },
    copyPayload() {
      const ids = multi.value.length > 0 ? multi.value : []
      const blocks = ids.map((id) => findBlock(model.document, id)).filter((block) => block !== undefined)
      return blocks.length === 0 ? undefined : { json: serializeBlocks(blocks), text: blocksToText(blocks) }
    },
    paste(data) {
      const at = multi.value.at(-1) ?? selection.blockId
      let blocks: readonly Block[] | undefined
      let target: { place: Place; parentType: string | null } | undefined
      if (data.json !== undefined) {
        // Checked where it lands: try the place after the block, then after each ancestor, until the blocks may stand there.
        const types = (parseClipboardBlocks(data.json, null) ?? []).map((block) => block.type)
        if (at === null) {
          target = { place: { parentId: null, index: model.document.length }, parentType: null }
        } else if (types.length > 0) {
          target = placeAfter(at, types)
        } else {
          // Blocks that only stand in a container (list items, buttons): after the block, in its own parent, if it takes them.
          const located = locate(model.document, at)
          target =
            located === undefined
              ? undefined
              : { place: { parentId: located.parentId, index: located.index + 1 }, parentType: located.parentType }
        }
        blocks = target === undefined ? undefined : parseClipboardBlocks(data.json, target.parentType)
        // Custom HTML is pasted only by those who may write it (the api refuses it anyway).
        // Custom HTML only from those who may write it, «Les mer» only in a post (the api refuses both anyway).
        if (
          blocks?.some((block) =>
            flatten([block]).some(
              (inner) => !mayInsert(inner.type) || !allowedInContentType(inner.type, scope.value.contentType),
            ),
          )
        )
          blocks = undefined
      } else if (data.text !== undefined) {
        blocks = textToBlocks(data.text)
        if (blocks !== undefined) {
          target =
            at === null
              ? { place: { parentId: null, index: model.document.length }, parentType: null }
              : placeAfter(at, ['core/paragraph'])
        }
      }
      if (blocks === undefined || target === undefined) {
        return false
      }
      return editor.insertBlocks(target.place, blocks)
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

/** The clipboard type of copied blocks, for the canvas's copy, cut and paste handlers. */
export { BLOCKS_MIME }
