<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { COLUMNS, IMAGE, PARAGRAPH } from '@toascribe/blocks'

// One block in the editor: a labelled group around the block's own edit component, and the keys that act on the block as a whole
// (move, delete). The keys are handled here and not in TipTap, so they work the same in a paragraph, an image's fields and on a
// columns block. Nested blocks handle the key first and mark it handled, so the columns block around them does not act again.
const props = defineProps<{ block: Block; parentType: string | null }>()

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()

const selected = computed(() => editor.selectedId.value === props.block.id)

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) {
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    editor.move(props.block.id, event.key === 'ArrowUp' ? 'up' : 'down')
  } else if (event.code === 'KeyZ') {
    event.preventDefault()
    editor.remove(props.block.id)
  }
}
</script>

<template>
  <div
    role="group"
    :aria-label="t('editorPrototype.blockLabel', { name: title(block.type) })"
    :data-block-id="block.id"
    :data-block-type="block.type"
    :class="[
      'rounded-md p-1 transition-shadow',
      selected ? 'ring-2 ring-primary' : 'ring-1 ring-transparent hover:ring-default',
    ]"
    @keydown="onKeydown"
  >
    <EditorParagraph v-if="block.type === PARAGRAPH" :block="block" :parent-type="parentType" :selected="selected" />
    <EditorImage v-else-if="block.type === IMAGE" :block="block" :selected="selected" />
    <EditorColumns v-else-if="block.type === COLUMNS" :block="block" :selected="selected" />
  </div>
</template>
