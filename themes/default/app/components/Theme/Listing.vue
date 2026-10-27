<script setup lang="ts">
// A list of posts with its heading and pages: the front page, the posts page, an archive or a search.
defineProps<{ heading?: string }>()
const { t } = useI18n()
const { list } = useContent()
</script>

<template>
  <section class="theme-listing">
    <h1 v-if="heading" class="theme-entry-title">{{ heading }}</h1>
    <h1 v-else class="theme-sr-only">{{ t('theme.latest') }}</h1>
    <template v-if="list && list.items.length > 0">
      <ThemeSummary v-for="item in list.items" :key="item.id" :item="item" />
      <ScribePagination :list="list" />
    </template>
    <p v-else class="theme-note">{{ t('theme.empty') }}</p>
  </section>
</template>
