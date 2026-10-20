<script setup lang="ts">
import { useHealthApi } from '~/lib/api/health'

useSeoMeta({ title: 'toascribe admin', description: 'Administrasjon for toascribe.' })

const healthApi = useHealthApi()
const { data, status, error, refresh } = await useAsyncData('health', () => healthApi.get())
</script>

<template>
  <main>
    <UContainer class="py-12 sm:py-16">
      <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">toascribe admin</h1>
      <p class="mt-4 mb-8 max-w-prose text-base text-muted sm:text-lg">
        Administrasjonen kommer i en senere versjon.
        <NuxtLink to="/setup" class="text-primary underline underline-offset-4">Gå til oppsett</NuxtLink>
      </p>
      <HealthApiStatus
        :health="data"
        :failed="error !== undefined"
        :pending="status === 'pending'"
        @retry="refresh()"
      />
    </UContainer>
  </main>
</template>
