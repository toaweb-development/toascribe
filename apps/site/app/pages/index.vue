<script setup lang="ts">
import { useHealthApi } from '~/lib/api/health'

const title = 'toascribe — selvhostet publiseringssystem'
const description =
  'toascribe er et selvhostet publiseringssystem i TypeScript, bygd for å erstatte WordPress. Dette er startsiden til en nyinstallasjon.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogType: 'website',
  ogSiteName: 'toascribe',
})

const healthApi = useHealthApi()
const { data, status, error, refresh } = await useAsyncData('health', () => healthApi.get())
</script>

<template>
  <main>
    <UContainer>
      <ThemeHero title="toascribe" lead="Et selvhostet publiseringssystem, bygd for å erstatte WordPress." />
      <HealthApiStatus
        :health="data"
        :failed="error !== undefined"
        :pending="status === 'pending'"
        @retry="refresh()"
      />
    </UContainer>
  </main>
</template>
