<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { BLOCKS_MIME, COLUMNS, GALLERY } from '@toascribe/blocks'

// The editing area. The tree of slots (BlockList, and the containers' own lists) is drawn first; then every block's component is drawn
// once, in a flat list keyed by id, into its dock (Teleport to an element that belongs to the block), and the slot puts the dock where
// the block stands. So a block keeps its component when it moves to another parent (decision note 0001, adjustment 2). The components
// are made in the browser only: until then, and for a server render, the document is shown as the site draws it.
//
// The keys that act on the whole document are taken here, before TipTap or a text field sees them: undo and redo (always the one
// history, never the browser's undo of a single field), and for a selection over several blocks Delete, Escape and the clipboard.
const editor = useBlockEditorContext()
const { t } = useI18n()

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

/** Blocks whose parent draws its children itself (the columns of a columns block, a gallery's images) have no slot of their own. */
const SELF_DRAWN: ReadonlySet<string> = new Set([COLUMNS, GALLERY])

interface Entry {
  readonly block: Block
  readonly parentType: string | null
}
const entries = computed<Entry[]>(() => {
  const list: Entry[] = []
  const walk = (blocks: readonly Block[], parentType: string | null, drawn: boolean) => {
    for (const block of blocks) {
      if (drawn) list.push({ block, parentType })
      walk(block.children, block.type, !SELF_DRAWN.has(block.type))
    }
  }
  walk(editor.document.value, null, true)
  return list
})

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && !event.altKey && (key === 'z' || key === 'y')) {
    event.preventDefault()
    if (key === 'y' || event.shiftKey) editor.redo()
    else editor.undo()
    return
  }
  // Gutenberg's «insert before» and «insert after» (Ctrl+Alt+T, Ctrl+Alt+Y): an empty paragraph next to the selected block.
  const selected = editor.selectedId.value
  if (mod && event.altKey && selected !== null && (event.code === 'KeyT' || event.code === 'KeyY')) {
    event.preventDefault()
    if (event.code === 'KeyT') editor.insertBefore(selected, 'core/paragraph')
    else editor.insertAfter(selected, 'core/paragraph')
    return
  }
  if (editor.multi.value.length === 0) return
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    editor.removeSelected()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    const last = editor.multi.value.at(-1)
    editor.clearMulti()
    if (last !== undefined) editor.focus({ blockId: last })
  } else if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    editor.extendSelectionBy(event.key === 'ArrowUp' ? 'up' : 'down')
  }
}

/** The browser's own undo (a menu, a gesture) arrives as `beforeinput`: send it to the document history too. */
function onBeforeInput(event: InputEvent): void {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault()
    if (event.inputType === 'historyUndo') editor.undo()
    else editor.redo()
  }
}

/** Copy and cut of a selection over several blocks: the blocks as JSON, and their text for other programs. */
function onCopy(event: ClipboardEvent, cut = false): void {
  const payload = editor.copyPayload()
  if (payload === undefined || event.clipboardData === null) return
  event.preventDefault()
  event.clipboardData.setData(BLOCKS_MIME, payload.json)
  event.clipboardData.setData('text/plain', payload.text)
  if (cut) editor.removeSelected()
}

/**
 * A paste: copied blocks go in as blocks, plain text of several paragraphs as paragraphs, after the selected block. A single line of
 * text is left to the text block (TipTap pastes it as text), and a paste into a form field (alt text, a caption) to the field.
 */
function onPaste(event: ClipboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea')) return
  const data = event.clipboardData
  if (data === null) return
  const json = data.getData(BLOCKS_MIME)
  const text = data.getData('text/plain')
  const handled = json !== '' ? editor.paste({ json }) : editor.paste({ text })
  if (handled) event.preventDefault()
}
</script>

<template>
  <div
    role="region"
    :aria-label="t('editorPrototype.canvasLabel')"
    data-editor-canvas
    tabindex="-1"
    class="flex flex-col outline-none"
    @keydown.capture="onKeydown"
    @beforeinput.capture="onBeforeInput"
    @copy="onCopy($event)"
    @cut="onCopy($event, true)"
    @paste.capture="onPaste"
  >
    <p v-if="editor.multi.value.length > 0" class="sr-only" role="status">
      {{ t('editor.selection.count', { n: editor.multi.value.length }, editor.multi.value.length) }}
    </p>
    <p v-if="editor.document.value.length === 0" class="pb-2 text-sm text-muted">{{ t('editorPrototype.empty') }}</p>
    <template v-if="mounted">
      <EditorBlockList :blocks="editor.document.value" :parent-id="null" :parent-type="null" />
      <Teleport v-for="entry in entries" :key="entry.block.id" :to="editor.dock(entry.block.id)">
        <EditorBlock :block="entry.block" :parent-type="entry.parentType" />
      </Teleport>
    </template>
    <BlocksDocument v-else :blocks="editor.document.value" />
  </div>
</template>
