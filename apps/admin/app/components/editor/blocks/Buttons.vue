<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { BUTTONS } from '@toascribe/blocks'

// Buttons (K-078): a row of button links, each a button block.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
</script>

<template>
  <EditorBlockList :blocks="block.children" :parent-id="block.id" :parent-type="BUTTONS" horizontal />
</template>
