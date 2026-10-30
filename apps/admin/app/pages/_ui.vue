<script setup lang="ts">
// «Blekk» (M2.1): every component and variant of the design system, with the light tokens and with the dark side by side, for
// whoever changes the look. In development only: nuxt.config.ts drops the route from a production build.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })
const { t } = useI18n()
useSeoMeta({ title: () => t('uiShowcase.title') })
</script>

<template>
  <AdminPage id="ui-showcase" :title="$t('uiShowcase.title')" width="wide">
    <div class="grid gap-6 2xl:grid-cols-2">
      <section aria-labelledby="ui-light" class="blekk-light overflow-hidden rounded-card ring ring-line">
        <h2 id="ui-light" class="bg-surface px-6 py-3 text-card-title font-semibold text-heading">
          {{ $t('uiShowcase.light') }}
        </h2>
        <UiShowcase theme="light" />
      </section>
      <section aria-labelledby="ui-dark" class="dark overflow-hidden rounded-card ring ring-line">
        <h2 id="ui-dark" class="bg-surface px-6 py-3 text-card-title font-semibold text-heading">
          {{ $t('uiShowcase.dark') }}
        </h2>
        <UiShowcase theme="dark" />
      </section>
    </div>
  </AdminPage>
</template>
