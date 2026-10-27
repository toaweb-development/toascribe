<script setup lang="ts">
// The core's maintenance page (M1.7, K-288; WordPress' «Briefly unavailable for scheduled maintenance»), drawn with status 503 while
// maintenance mode is on, for anyone who may not manage the site. A theme draws its own with `templates/maintenance.vue`.
const { t } = useI18n()
const settings = useSettings()
const message = computed(() => settings.value?.maintenance.message ?? '')
</script>

<template>
  <section class="scribe-maintenance" aria-labelledby="scribe-maintenance-title">
    <h1 id="scribe-maintenance-title">{{ t('scribe.maintenance.title') }}</h1>
    <p>{{ message || t('scribe.maintenance.text') }}</p>
  </section>
</template>
