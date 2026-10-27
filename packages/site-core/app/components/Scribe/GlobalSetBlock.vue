<script setup lang="ts">
// The core view of the «Globalt sett» block (K-106): the set the block names, drawn where the block stands (ScribeGlobalSet).
import type { Block } from '@toascribe/blocks'

const props = defineProps<{ block: Block; context: unknown }>()
const slug = computed(() => (typeof props.block.attrs['slug'] === 'string' ? props.block.attrs['slug'] : ''))
</script>

<template>
  <ScribeGlobalSet :slug="slug" />
</template>
