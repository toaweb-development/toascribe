<script setup lang="ts">
const { t } = useI18n()

const title = t('site.home.title')
const description = t('site.home.description')

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  ogSiteName: t('brand.name'),
})

const healthApi = useHealthApi()
const { data, status, error, refresh } = await useAsyncData('health', () => healthApi.get())
</script>

<template>
  <main>
    <UContainer>
      <ThemeHero :title="$t('brand.name')" :lead="$t('site.home.lead')" />
      <HealthApiStatus
        :health="data"
        :failed="error !== undefined"
        :pending="status === 'pending'"
        @retry="refresh()"
      />
    </UContainer>
  </main>
</template>
