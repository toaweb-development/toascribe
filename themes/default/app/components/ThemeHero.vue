<script setup lang="ts">
defineProps<{
  /** The page's one h1. */
  title: string
  /** One line under the title. */
  lead: string
}>()
</script>

<template>
  <header class="py-12 sm:py-16">
    <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">{{ title }}</h1>
    <p class="mt-4 max-w-prose text-base text-muted sm:text-lg">{{ lead }}</p>
  </header>
</template>
