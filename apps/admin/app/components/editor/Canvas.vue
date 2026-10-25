<script setup lang="ts">
// The editing area: the top-level list of blocks, and the keys that act on the whole document. Undo and redo are taken here,
// before TipTap or a text field sees them, so they always go to the document's one history and never to the browser's own undo
// of a single field.
const editor = useBlockEditorContext()
const { t } = useI18n()

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (!mod || event.altKey) {
    return
  }
  const key = event.key.toLowerCase()
  if (key === 'z' || key === 'y') {
    event.preventDefault()
    if (key === 'y' || event.shiftKey) {
      editor.redo()
    } else {
      editor.undo()
    }
  }
}

/** The browser's own undo (a menu, a gesture) arrives as `beforeinput`: send it to the document history too. */
function onBeforeInput(event: InputEvent): void {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault()
    if (event.inputType === 'historyUndo') {
      editor.undo()
    } else {
      editor.redo()
    }
  }
}
</script>

<template>
  <div
    role="region"
    :aria-label="t('editorPrototype.canvasLabel')"
    class="flex flex-col"
    @keydown.capture="onKeydown"
    @beforeinput.capture="onBeforeInput"
  >
    <p v-if="editor.document.value.length === 0" class="pb-2 text-sm text-muted">{{ t('editorPrototype.empty') }}</p>
    <EditorBlockList :blocks="editor.document.value" :parent-id="null" :parent-type="null" />
  </div>
</template>
