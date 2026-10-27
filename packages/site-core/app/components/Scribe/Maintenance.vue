<script setup lang="ts">
// The core's maintenance page (M1.7, K-288; WordPress' «Briefly unavailable for scheduled maintenance»), drawn with status 503 while
// maintenance mode is on, for anyone who may not manage the site, without the theme's layout. A theme draws its own with
// `templates/maintenance.vue` (with <ScribeHead /> in it).
const { t } = useI18n()
const settings = useSettings()
const message = computed(() => settings.value?.maintenance.message ?? '')
</script>

<template>
  <!-- The page has no layout (nothing of the site comes with it): the head is drawn here. -->
  <ScribeHead />
  <main class="scribe-maintenance" aria-labelledby="scribe-maintenance-title">
    <h1 id="scribe-maintenance-title">{{ t('scribe.maintenance.title') }}</h1>
    <p>{{ message || t('scribe.maintenance.text') }}</p>
  </main>
</template>
