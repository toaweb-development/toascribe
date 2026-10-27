<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <section class="theme-entry">
    <h1 class="theme-entry-title">{{ t('theme.notFound.heading') }}</h1>
    <p>{{ t('theme.notFound.text') }}</p>
    <ScribeSearchForm />
    <p>
      <a href="/">{{ t('theme.notFound.home') }}</a>
    </p>
  </section>
</template>
