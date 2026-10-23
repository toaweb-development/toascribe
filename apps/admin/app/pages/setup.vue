<script setup lang="ts">
// The setup wizard (M0.4), at /admin/setup. The page is drawn on the server (the heading and a short "starting" line); the
// wizard itself runs in the browser only, because the setup code lives there (the address, then this tab's session storage)
// and is never part of the page the server sends. The middleware in the shared layer (setup-redirect.global.ts) sends every
// page here until the site is installed, and answers 404 here afterwards.
const { t } = useI18n()

useSeoMeta({ title: () => t('setup.title'), description: () => t('setup.intro') })
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
    <header class="flex flex-col gap-3">
      <p class="text-3xl font-bold text-highlighted">{{ $t('brand.name') }}</p>
      <h1 class="text-2xl font-semibold text-highlighted sm:text-3xl">{{ $t('setup.heading') }}</h1>
      <p class="max-w-prose text-base text-default sm:text-lg">{{ $t('setup.intro') }}</p>
    </header>

    <ClientOnly>
      <SetupWizard />
      <template #fallback>
        <p role="status" class="text-base text-default">{{ $t('setup.starting') }}</p>
      </template>
    </ClientOnly>
  </main>
</template>
