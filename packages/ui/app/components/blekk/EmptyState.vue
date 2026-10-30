<script setup lang="ts">
// An empty list or screen (M2.1, «Blekk»): an icon, what is missing, a line on what to do, and at most one action in the slot.
const props = withDefaults(defineProps<{ title: string; text?: string; icon?: string }>(), {
  text: undefined,
  icon: 'i-lucide-inbox',
})
</script>

<template>
  <div
    class="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-10 text-center"
  >
    <UIcon :name="props.icon" class="size-8 text-secondary" aria-hidden="true" />
    <p class="text-card-title font-semibold text-heading">{{ props.title }}</p>
    <p v-if="props.text" class="max-w-prose text-body text-secondary">{{ props.text }}</p>
    <div v-if="$slots.default" class="mt-1 flex flex-wrap justify-center gap-3">
      <slot />
    </div>
  </div>
</template>
