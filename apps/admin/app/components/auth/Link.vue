<script setup lang="ts">
// One link under the form box. A list item, 44 px high (mobile standard, touch targets).
defineProps<{
  to: string | { path: string; query?: Record<string, string> }
}>()
</script>

<template>
  <li>
    <NuxtLink
      :to="to"
      class="inline-flex min-h-control items-center text-help text-secondary underline underline-offset-4 hover:text-highlighted"
    >
      <slot />
    </NuxtLink>
  </li>
</template>
