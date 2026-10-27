<script setup lang="ts">
// The core view of the «Globalt sett» block (K-106): the set's blocks where the block stands. A set that shows itself, or a chain of
// sets that comes back to one already drawn, stops there: each set is drawn once on its way down.
import type { Block } from '@toascribe/blocks'

const props = defineProps<{ block: Block; context: unknown }>()
const slug = computed(() => (typeof props.block.attrs['slug'] === 'string' ? props.block.attrs['slug'] : ''))
const above = inject<readonly string[]>('scribe:global-sets', [])
const repeated = computed(() => slug.value === '' || above.includes(slug.value))
provide('scribe:global-sets', [...above, slug.value])
const set = useGlobalSet(slug)
</script>

<template>
  <div v-if="!repeated && set" class="block-global-set" :data-set="slug">
    <ScribeBlocks :blocks="set.blocks" :media="set.media" />
  </div>
</template>
