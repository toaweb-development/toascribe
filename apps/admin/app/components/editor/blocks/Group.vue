<script setup lang="ts">
import type { Block } from '@toascribe/blocks'
import { GROUP } from '@toascribe/blocks'

// A group (K-078): blocks kept together, which a theme can style as one section.
defineProps<{ block: Block; parentType: string | null; selected: boolean }>()
</script>

<template>
  <div class="rounded-md border border-dashed border-default p-2">
    <EditorBlockList :blocks="block.children" :parent-id="block.id" :parent-type="GROUP" />
  </div>
</template>
