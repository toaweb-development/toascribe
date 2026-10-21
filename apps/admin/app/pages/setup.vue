<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({ title: t('admin.setup.title'), description: t('admin.setup.description') })
</script>

<template>
  <main>
    <UContainer class="py-12 sm:py-16">
      <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">{{ $t('admin.setup.heading') }}</h1>
      <p class="mt-4 max-w-prose text-base text-muted sm:text-lg">{{ $t('admin.setup.intro') }}</p>
    </UContainer>
  </main>
</template>
