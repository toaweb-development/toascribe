<script setup lang="ts">
import type { Component } from 'vue'

import type { Block } from '@toascribe/blocks'
import {
  EditorBlocksButton,
  EditorBlocksButtons,
  EditorBlocksCode,
  EditorBlocksColumns,
  EditorBlocksGallery,
  EditorBlocksGroup,
  EditorBlocksHeading,
  EditorBlocksHtml,
  EditorBlocksImage,
  EditorBlocksList,
  EditorBlocksListItem,
  EditorBlocksMore,
  EditorBlocksNextpage,
  EditorBlocksParagraph,
  EditorBlocksPreformatted,
  EditorBlocksQuery,
  EditorBlocksQuote,
  EditorBlocksSeparator,
  EditorBlocksSpacer,
  EditorBlocksTable,
} from '#components'

// One block in the editor: a labelled group around the block's own edit component (components/editor/blocks, one per block type,
// PLAN «Regler for blokker» 6), and what acts on the block as a whole: the keys to move and delete it, Shift+click to select several
// blocks, and the mark of a selection. The keys are handled here and not in TipTap, so they work the same in a paragraph, an image's
// fields and on a columns block. Nested blocks handle a key first and mark it handled, so the block around them does not act again.
const props = defineProps<{ block: Block; parentType: string | null }>()

const EDIT: Readonly<Record<string, Component>> = {
  'core/paragraph': EditorBlocksParagraph,
  'core/heading': EditorBlocksHeading,
  'core/list': EditorBlocksList,
  'core/list-item': EditorBlocksListItem,
  'core/quote': EditorBlocksQuote,
  'core/code': EditorBlocksCode,
  'core/preformatted': EditorBlocksPreformatted,
  'core/table': EditorBlocksTable,
  'core/image': EditorBlocksImage,
  'core/gallery': EditorBlocksGallery,
  'core/buttons': EditorBlocksButtons,
  'core/button': EditorBlocksButton,
  'core/columns': EditorBlocksColumns,
  'core/group': EditorBlocksGroup,
  'core/separator': EditorBlocksSeparator,
  'core/spacer': EditorBlocksSpacer,
  'core/more': EditorBlocksMore,
  'core/nextpage': EditorBlocksNextpage,
  'core/html': EditorBlocksHtml,
  'core/query': EditorBlocksQuery,
}

const editor = useBlockEditorContext()
const { title } = useBlockText()
const { t } = useI18n()

const selected = computed(() => editor.selectedId.value === props.block.id && editor.multi.value.length === 0)
const inMulti = computed(() => editor.multi.value.includes(props.block.id))
const component = computed(() => EDIT[props.block.type])

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

/** Shift+click selects from the selected block to this one (siblings; across parents, their ancestors under the common parent). */
function onMousedown(event: MouseEvent): void {
  if (!event.shiftKey || event.defaultPrevented || editor.selectedId.value === null) return
  event.preventDefault()
  event.stopPropagation()
  editor.extendSelection(props.block.id)
}
</script>

<template>
  <div
    role="group"
    :aria-label="t('editorPrototype.blockLabel', { name: title(block.type) })"
    :data-selected="inMulti ? 'true' : undefined"
    :data-block-id="block.id"
    :data-block-type="block.type"
    :class="[
      'rounded-md p-1 transition-shadow',
      inMulti
        ? 'bg-primary/10 ring-2 ring-primary'
        : selected
          ? 'ring-2 ring-primary'
          : 'ring-1 ring-transparent hover:ring-default',
    ]"
    @keydown="onKeydown"
    @mousedown.capture="onMousedown"
  >
    <component :is="component" v-if="component" :block="block" :parent-type="parentType" :selected="selected" />
    <UAlert
      v-else
      color="warning"
      variant="subtle"
      icon="i-lucide-puzzle"
      :title="t('editor.unknownBlock', { name: block.type })"
    />
  </div>
</template>
