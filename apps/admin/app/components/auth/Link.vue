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
      class="inline-flex min-h-11 items-center text-sm text-toned underline underline-offset-4 hover:text-highlighted"
    >
      <slot />
    </NuxtLink>
  </li>
</template>
