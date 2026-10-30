<script setup lang="ts">
// The setup wizard (M0.4), at /admin/setup. The page is drawn on the server (the heading and a short "starting" line); the
// wizard itself runs in the browser only, because the setup code lives there: it arrives in the fragment of the address (`#token=`,
// which a browser never sends to a server), then it is in this tab's session storage. So it is never part of the page the
// server draws, and no log of the proxy or the app can have it. The middleware in the shared layer (setup-redirect.global.ts) sends every
// page here until the site is installed, and answers 404 here afterwards.
const { t } = useI18n()

useSeoMeta({ title: () => t('setup.title'), description: () => t('setup.intro') })
</script>

<template>
  <div class="min-h-dvh bg-app">
    <main class="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header class="flex flex-col gap-3">
        <p class="flex items-center gap-2.5 text-card-title font-semibold text-heading">
          <BlekkLogoMark />
          {{ $t('brand.name') }}
        </p>
        <h1 class="text-page-title font-semibold text-heading">{{ $t('setup.heading') }}</h1>
        <p class="max-w-prose text-body text-secondary">{{ $t('setup.intro') }}</p>
      </header>

      <ClientOnly>
        <SetupWizard />
        <template #fallback>
          <p role="status" class="text-body text-heading">{{ $t('setup.starting') }}</p>
        </template>
      </ClientOnly>
    </main>
  </div>
</template>
