<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({ title: t('admin.name'), description: t('admin.home.description') })

const healthApi = useHealthApi()
const { data, status, error, refresh } = await useAsyncData('health', () => healthApi.get())
</script>

<template>
  <main>
    <UContainer class="py-12 sm:py-16">
      <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">{{ $t('admin.name') }}</h1>
      <p class="mt-4 mb-8 max-w-prose text-base text-muted sm:text-lg">
        {{ $t('admin.home.intro') }}
        <NuxtLink to="/setup" class="text-primary underline underline-offset-4">{{
          $t('admin.home.setupLink')
        }}</NuxtLink>
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
