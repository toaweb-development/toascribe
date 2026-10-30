<script setup lang="ts">
// toascribe's mark (M2.1, «Blekk»): the pen on the accent, in a rounded square. Decorative: the name beside it, or the link around it,
// says what it is.
const props = withDefaults(defineProps<{ size?: 'md' | 'lg' }>(), { size: 'md' })
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-menu bg-accent text-on-accent"
    :class="props.size === 'lg' ? 'size-10' : 'size-7'"
    aria-hidden="true"
  >
    <UIcon name="i-lucide-pen-line" :class="props.size === 'lg' ? 'size-5' : 'size-4'" />
  </span>
</template>
