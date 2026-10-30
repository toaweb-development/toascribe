<script setup lang="ts">
// The second line of a list row on a narrow screen (M2.1, «Blekk»; WordPress' list tables below 782 px): the facts the hidden columns
// show from `md` (a post's status and date, a user's role), under the title and above the row's actions. From `md` it is gone, so the
// columns are read once.
</script>

<template>
  <span class="flex flex-wrap gap-x-2 text-help text-secondary md:hidden">
    <slot />
  </span>
</template>
