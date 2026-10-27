<script setup lang="ts">
// A global set by its slug (K-106), for a theme's layout and for the «Globalt sett» block alike. A set that shows itself, or a chain
// of sets that comes back to one already drawn, stops there: each set is drawn once on its way down.
const props = defineProps<{ slug: string }>()
const above = inject<readonly string[]>('scribe:global-sets', [])
const repeated = computed(() => props.slug === '' || above.includes(props.slug))
provide('scribe:global-sets', [...above, props.slug])
const set = useGlobalSet(() => props.slug)
</script>

<template>
  <div v-if="!repeated && set && set.blocks.length > 0" class="block-global-set" :data-set="slug">
    <ScribeBlocks :blocks="set.blocks" :media="set.media" />
  </div>
</template>
