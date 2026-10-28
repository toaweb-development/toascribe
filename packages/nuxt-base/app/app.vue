<script setup lang="ts">
// Nuxt UI's own texts (labels of close buttons and the like) follow the active locale. Add a locale here when the
// i18n config gets one.
import { en, nb_no } from '@nuxt/ui/locale'

// <html lang> and <html dir> come from the active locale. useLocaleHead is not used: it warns without the site's public
// address (its `baseUrl`), which only its SEO links need, and the admin's languages are not separate addresses, so it has none.
const { locale, localeProperties } = useI18n()
const uiLocale = computed(() => (locale.value === 'en' ? en : nb_no))
useHead({ htmlAttrs: { lang: () => localeProperties.value.language, dir: () => localeProperties.value.dir } })
</script>

<template>
  <UApp :locale="uiLocale">
    <!-- An app that has layouts (the admin's dashboard shell) gets them; one with none (the site) renders the page as before. -->
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
