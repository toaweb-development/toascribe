<script setup lang="ts">
import type { Block } from '@toascribe/blocks'

// The blocks of one parent (the top level or a column), with a «+» between two blocks and one at the end. Keyed by block id, so a
// block that moves within the list keeps its component and its TipTap instance.
defineProps<{ blocks: readonly Block[]; parentId: string | null; parentType: string | null }>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col">
    <template v-for="(block, index) in blocks" :key="block.id">
      <EditorBlock :block="block" :parent-type="parentType" />
      <div class="group/between flex h-6 items-center justify-center">
        <EditorInserter
          v-if="index < blocks.length - 1"
          subtle
          :place="{ parentId, index: index + 1 }"
          :parent-type="parentType"
        />
      </div>
    </template>
    <div>
      <EditorInserter
        :place="{ parentId, index: blocks.length }"
        :parent-type="parentType"
        :label="t('editorPrototype.addBlock')"
      />
    </div>
  </div>
</template>
