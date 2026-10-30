<script setup lang="ts">
// A list row's actions (M2.1, «Blekk»), under the title in the row's main cell. From `md` with a fine pointer they wait for the pointer or
// the keyboard (the row is a `group`), as the sketch and WordPress have it; on a narrow screen and on touch they are always shown,
// 44 px high (MOBILE_STANDARD: 44 px under `lg`). They are only transparent, never hidden, so a screen reader reads them with the item.
const props = defineProps<{ label: string }>()
</script>

<template>
  <ul
    :aria-label="props.label"
    class="flex flex-wrap items-center gap-x-3 transition-opacity md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100 md:pointer-fine:group-focus-within:opacity-100"
  >
    <slot />
  </ul>
</template>
