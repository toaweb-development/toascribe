<script setup lang="ts">
const { t } = useI18n()
const { archive, list } = useContent()
const query = computed(() => (archive.value?.type === 'search' ? archive.value.query : ''))
</script>

<template>
  <ThemeListing :heading="t('theme.search.heading', { query })" />
  <p v-if="list && list.total > 0" class="theme-note" role="status">
    {{ t('theme.search.count', { count: list.total }) }}
  </p>
</template>
