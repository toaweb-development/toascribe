<script setup lang="ts">
// The last fallback of the hierarchy (required): an item when the address is one, a list when it is a list.
const { content } = useContent()
</script>

<template>
  <ThemeEntry v-if="content" />
  <ThemeListing v-else />
</template>
