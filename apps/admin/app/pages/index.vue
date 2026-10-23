<script setup lang="ts">
const { t } = useI18n()

useSeoMeta({ title: t('admin.name'), description: t('admin.home.description') })

// Who is signed in, if anyone. The shell with the menu and the profile is a later version; for now only this line.
// If the API cannot answer, the page is the same without it.
const auth = useAuth()
await auth.ensure().catch(() => undefined)
const account = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))

const healthApi = useHealthApi()
const { data, status, error, refresh } = await useAsyncData('health', () => healthApi.get())
</script>

<template>
  <main>
    <UContainer class="py-12 sm:py-16">
      <h1 class="text-3xl font-bold text-highlighted sm:text-5xl">{{ $t('admin.name') }}</h1>
      <p class="mt-4 mb-8 max-w-prose text-base text-muted sm:text-lg">
        {{ $t('admin.home.intro') }}
      </p>
      <p v-if="account" class="mb-8 text-base text-default">
        {{ $t('auth.signedInAs', { name: account.displayName }) }}
        <NuxtLink
          to="/logout"
          class="ml-2 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >{{ $t('auth.logout.link') }}</NuxtLink
        >
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
