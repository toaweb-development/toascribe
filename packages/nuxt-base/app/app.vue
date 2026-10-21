<script setup lang="ts">
// Nuxt UI's own texts (labels of close buttons and the like) follow the active locale. Add a locale here when the
// i18n config gets one.
import { nb_no } from '@nuxt/ui/locale'

// <html lang> and <html dir> come from the active locale. useLocaleHead is not used: it warns without the site's public
// address (its `baseUrl`), which only its SEO links need, and with one locale there are none.
const { localeProperties } = useI18n()
useHead({ htmlAttrs: { lang: () => localeProperties.value.language, dir: () => localeProperties.value.dir } })
</script>

<template>
  <UApp :locale="nb_no">
    <NuxtPage />
  </UApp>
</template>
