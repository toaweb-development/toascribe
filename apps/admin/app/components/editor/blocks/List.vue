<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { LIST } from '@toascribe/blocks'

// A list (K-078): its items, each a block with its own text (Gutenberg's list item), so Enter, Backspace, Tab and Shift+Tab are
// operations on the block tree. Bulleted or numbered is set in the item's toolbar or the block settings.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
</script>

<template>
  <div :data-list="block.attrs['ordered'] === true ? 'ordered' : 'bullets'" class="ps-2">
    <EditorBlockList :blocks="block.children" :parent-id="block.id" :parent-type="LIST" />
  </div>
</template>
