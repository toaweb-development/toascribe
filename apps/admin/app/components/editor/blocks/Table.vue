<script setup lang="ts">
import type { Block, InlineNode } from '@toascribe/blocks'
import { getBlockDefinition } from '@toascribe/blocks'

// A table (K-078): a simple grid of cells, each rich text, the first row a header row when «Topprad» is on (block settings). The
// toolbar adds and removes rows and columns at the cell that has the cursor. A cell is data like any rich text: no markup in it.
const props = defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
const editor = useBlockEditorContext()
const { t } = useI18n()

const limits = (() => {
  const schema = getBlockDefinition('core/table')?.attributes['cells']
  return schema?.type === 'table' ? { rows: schema.maxRows, columns: schema.maxColumns } : { rows: 100, columns: 10 }
})()
const cells = computed<InlineNode[][][]>(() =>
  Array.isArray(props.block.attrs['cells']) ? (props.block.attrs['cells'] as InlineNode[][][]) : [[[]]],
)
const hasHeader = computed(() => props.block.attrs['hasHeader'] === true)
const columnCount = computed(() => cells.value[0]?.length ?? 1)
const current = ref({ row: 0, column: 0 })

function setCells(next: InlineNode[][][], group?: string): void {
  editor.setAttrs(props.block.id, { cells: next }, group)
}
function setCell(row: number, column: number, content: InlineNode[], kind: 'text' | 'format'): void {
  const next = cells.value.map((cellsOfRow, r) =>
    cellsOfRow.map((cell, c) => (r === row && c === column ? content : cell)),
  )
  setCells(next, kind === 'text' ? `cell:${props.block.id}:${String(row)}:${String(column)}` : undefined)
}
function addRow(): void {
  const at = current.value.row + 1
  setCells([...cells.value.slice(0, at), Array.from({ length: columnCount.value }, () => []), ...cells.value.slice(at)])
}
function removeRow(): void {
  if (cells.value.length <= 1) return
  setCells(cells.value.filter((_, r) => r !== current.value.row))
  current.value = { row: Math.max(0, current.value.row - 1), column: current.value.column }
}
function addColumn(): void {
  const at = current.value.column + 1
  setCells(cells.value.map((row) => [...row.slice(0, at), [], ...row.slice(at)]))
}
function removeColumn(): void {
  if (columnCount.value <= 1) return
  setCells(cells.value.map((row) => row.filter((_, c) => c !== current.value.column)))
  current.value = { row: current.value.row, column: Math.max(0, current.value.column - 1) }
}

const root = useTemplateRef<HTMLElement>('root')
const handler = { focus: () => root.value?.querySelector<HTMLElement>('[role="textbox"]')?.focus() }
onMounted(() => editor.registerFocus(props.block.id, handler))
onBeforeUnmount(() => editor.unregisterFocus(props.block.id, handler))
function onFocusIn(row: number, column: number): void {
  current.value = { row, column }
  if (!props.selected) editor.select({ blockId: props.block.id })
}
const cellLabel = (row: number, column: number) => t('editor.table.cell', { row: row + 1, column: column + 1 })
</script>

<template>
  <div ref="root" class="flex flex-col gap-1">
    <EditorToolbar v-if="selected" :block="block">
      <UButton
        icon="i-lucide-between-horizontal-end"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editor.table.addRow')"
        :disabled="cells.length >= limits.rows"
        @mousedown.prevent
        @click="addRow"
      />
      <UButton
        icon="i-lucide-between-vertical-end"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editor.table.addColumn')"
        :disabled="columnCount >= limits.columns"
        @mousedown.prevent
        @click="addColumn"
      />
      <UButton
        icon="i-lucide-rows-2"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editor.table.removeRow')"
        :disabled="cells.length <= 1"
        @mousedown.prevent
        @click="removeRow"
      />
      <UButton
        icon="i-lucide-columns-2"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('editor.table.removeColumn')"
        :disabled="columnCount <= 1"
        @mousedown.prevent
        @click="removeColumn"
      />
    </EditorToolbar>
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <tbody>
          <tr v-for="(row, r) in cells" :key="r">
            <td
              v-for="(cell, c) in row"
              :key="c"
              :class="[
                'min-w-28 border border-default align-top',
                hasHeader && r === 0 ? 'bg-elevated font-semibold' : '',
              ]"
              @focusin="onFocusIn(r, c)"
            >
              <EditorRichText
                :block="block"
                attr="cells"
                :value="cell"
                enter="none"
                :label="cellLabel(r, c)"
                @change="(content, kind) => setCell(r, c, content, kind)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
