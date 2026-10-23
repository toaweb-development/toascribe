<script setup lang="ts">
import type { NuxtError } from '#app'
import { nb_no } from '@nuxt/ui/locale'

// The page for an error that Nuxt shows instead of the app: a page that does not exist (and the setup wizard once the site is
// installed), or a failure while drawing a page. The text is ours; the error's own message is a technical English line. The
// error is not a place to print what the address said.
const props = defineProps<{
  error: NuxtError
}>()

const { t, localeProperties } = useI18n()

const notFound = computed(() => props.error.statusCode === 404)
const heading = computed(() => (notFound.value ? t('errorPage.notFound.heading') : t('errorPage.failed.heading')))

useHead({ htmlAttrs: { lang: () => localeProperties.value.language, dir: () => localeProperties.value.dir } })
useSeoMeta({ title: heading, robots: 'noindex, nofollow' })

function leave() {
  void clearError({ redirect: '/' })
}
</script>

<template>
  <UApp :locale="nb_no">
    <main class="mx-auto flex min-h-dvh w-full max-w-prose flex-col items-start justify-center gap-6 px-4 py-12">
      <p class="text-sm font-semibold text-toned">{{ error.statusCode }}</p>
      <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">{{ heading }}</h1>
      <p class="text-base text-default sm:text-lg">
        {{ notFound ? $t('errorPage.notFound.text') : $t('errorPage.failed.text') }}
      </p>
      <UButton size="xl" class="min-h-11" @click="leave">{{ $t('errorPage.home') }}</UButton>
    </main>
  </UApp>
</template>
