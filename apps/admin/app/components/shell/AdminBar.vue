<script setup lang="ts">
// The bar across the top (WordPress' admin bar, in the admin): the site's name, which leads to the site, and «Hei, {name}» with the
// account's own pages. «+ Ny» is not here: nothing it would offer works yet.
const { t } = useI18n()
const siteName = useSiteName()
const auth = useAuth()

const name = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.displayName : '',
)

const items = computed(() => [
  [
    { label: t('shell.bar.profile'), icon: 'i-lucide-user', to: '/profile' },
    { label: t('auth.logout.link'), icon: 'i-lucide-log-out', to: '/logout' },
  ],
])
</script>

<template>
  <header
    class="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-default bg-elevated px-4 sm:px-6"
  >
    <!-- Outside the admin (`/`), so a full page load, in the same tab. -->
    <NuxtLink
      to="/"
      external
      class="inline-flex min-h-11 min-w-0 items-center text-sm font-semibold text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span class="sr-only">{{ $t('shell.bar.visit') }}</span>
      <span class="truncate">{{ siteName }}</span>
    </NuxtLink>

    <UDropdownMenu :items="items" :content="{ align: 'end' }" :ui="{ content: 'min-w-48' }">
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        class="min-h-11 max-w-56 min-w-0"
        trailing-icon="i-lucide-chevron-down"
        :aria-label="$t('shell.bar.howdy', { name }) + '. ' + $t('shell.bar.userMenu')"
      >
        <span class="truncate">{{ $t('shell.bar.howdy', { name }) }}</span>
      </UButton>
    </UDropdownMenu>
  </header>
</template>
