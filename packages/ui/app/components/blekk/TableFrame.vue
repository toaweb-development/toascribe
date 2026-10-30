<script setup lang="ts">
// The box a list's table sits in (M2.1, «Blekk»): the card's surface and edge, and on a narrow screen the table scrolls sideways
// inside it, not the page. The box takes focus so the keyboard can scroll it too (WCAG 2.1.1; axe's scrollable-region-focusable), and
// its name is the table's.
const props = defineProps<{ label: string }>()
</script>

<template>
  <div
    role="region"
    :aria-label="props.label"
    tabindex="0"
    class="overflow-x-auto rounded-card border border-line bg-surface"
  >
    <slot />
  </div>
</template>
