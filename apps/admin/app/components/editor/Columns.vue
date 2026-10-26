<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { COLUMN, COLUMNS, flatten, getBlockDefinition } from '@toascribe/blocks'

// Columns: 2 to 4 columns side by side (one under the other on a phone), each a list of paragraphs and images. The columns block
// is structure in the block tree, not in ProseMirror: each paragraph in it has its own TipTap like any other. Its toolbar shows
// while the cursor is anywhere inside it, with the count of columns.
const props = defineProps<{ block: Block; selected: boolean }>()

const editor = useBlockEditorContext()
const { t } = useI18n()

const limits = getBlockDefinition(COLUMNS)?.childCount ?? { min: 2, max: 4 }
const count = computed(() => props.block.children.length)
const holdsCursor = computed(
  () => props.selected || flatten(props.block.children).some((inner) => inner.id === editor.selectedId.value),
)
// Static class names, so Tailwind finds them.
const GRID: Readonly<Record<number, string>> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }

const root = useTemplateRef<HTMLElement>('root')
const handler = {
  focus() {
    root.value?.querySelector<HTMLElement>('[role="toolbar"] button, [contenteditable="true"]')?.focus()
  },
}
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))
</script>

<template>
  <div ref="root" class="flex flex-col gap-2">
    <EditorToolbar v-if="holdsCursor" :block="block">
      <span class="px-1 text-xs text-muted">{{ t('editorPrototype.columns.count', { n: count }) }}</span>
      <UButton
        icon="i-lucide-columns-3"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editorPrototype.columns.add')"
        :disabled="count >= limits.max"
        @click="editor.addColumn(block.id)"
      />
      <UButton
        icon="i-lucide-columns-2"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editorPrototype.columns.removeLast')"
        :disabled="count <= limits.min"
        @click="editor.removeColumn(block.id)"
      />
    </EditorToolbar>
    <div :class="['grid grid-cols-1 gap-4', GRID[count]]">
      <div
        v-for="(column, index) in block.children"
        :key="column.id"
        role="group"
        :aria-label="t('editorPrototype.columns.column', { n: index + 1 })"
        :data-block-id="column.id"
        :data-block-type="COLUMN"
        class="min-w-0 rounded-md border border-dashed border-default p-2"
      >
        <EditorBlockList :blocks="column.children" :parent-id="column.id" :parent-type="COLUMN" />
      </div>
    </div>
  </div>
</template>
