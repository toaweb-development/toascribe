<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// The blocks of one parent (the top level, a column, a group, a quote, a list, buttons): a slot per block, where the block's component
// is put (Slot.vue), with a «+» between two blocks and one at the end. `horizontal` lays them out in a row (buttons), with no «+»
// between them.
const props = withDefaults(
  defineProps<{ blocks: readonly Block[]; parentId: string | null; parentType: string | null; horizontal?: boolean }>(),
  { horizontal: false },
)

const { t } = useI18n()
const editor = useBlockEditorContext()
/** The «+» at the end, unless the parent may not take another block (the inserter would offer nothing). */
const canAdd = computed(() => editorInsertableBlocks(props.parentType, editor.scope.value).length > 0)
</script>

<template>
  <div :class="horizontal ? 'flex flex-wrap items-start gap-2' : 'flex flex-col'">
    <template v-for="(block, index) in blocks" :key="block.id">
      <EditorSlot :block-id="block.id" />
      <div v-if="!horizontal" class="group/between flex h-6 items-center justify-center">
        <EditorInserter
          v-if="index < blocks.length - 1"
          subtle
          :place="{ parentId, index: index + 1 }"
          :parent-type="parentType"
        />
      </div>
    </template>
    <div v-if="canAdd">
      <EditorInserter
        :place="{ parentId, index: blocks.length }"
        :parent-type="parentType"
        :label="t('editorPrototype.addBlock')"
      />
    </div>
  </div>
</template>
