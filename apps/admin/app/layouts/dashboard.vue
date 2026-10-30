<script setup lang="ts">
// The shell of every signed-in admin page (nuxt-vue §4.1; M2.1 «Blekk»): the side menu the whole height (the logo, the site, the menu,
// the account) and, to the right of it, the page, which brings its own panel with the top bar (components/AdminPage.vue). The sign-in screens and the setup wizard have
// no layout. A page picks this one with `definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })`.
const router = useRouter()

// The site's name for the bar. A shell page does not fetch it itself, so it is asked for here (the answer goes with the page).
await useAuthOptions()

// The account's colour scheme, on the first paint and whenever it is changed (the profile page).
useAdminColorScheme().follow()

// A new page replaces the old under the person's hands. Focus moves to the main region so a screen reader announces it and the
// next Tab reaches the page, not the menu again. Not on arrival: the browser starts at the top of a new page by itself.
const main = useTemplateRef<HTMLElement>('main')
onMounted(() => {
  const stop = router.afterEach((to, from) => {
    if (to.path !== from.path) {
      void nextTick(() => main.value?.focus({ preventScroll: true }))
    }
  })
  onBeforeUnmount(stop)
})
</script>

<template>
  <div class="fixed inset-0 flex">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-field focus:bg-surface focus:px-4 focus:py-3 focus:text-highlighted"
      @click.prevent="main?.focus()"
    >
      {{ $t('shell.skipToContent') }}
    </a>

    <UDashboardGroup unit="rem" class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar
        id="admin"
        collapsible
        :ui="{
          root: 'bg-sidebar border-sidebar-line',
          header: 'h-auto px-4 pt-5 pb-3',
          body: 'gap-4 px-3',
          footer: 'border-t border-sidebar-line px-3 py-3',
        }"
      >
        <template #header="{ collapsed }">
          <NuxtLink
            to="/"
            class="inline-flex min-h-control items-center gap-2.5 rounded-menu px-1 font-semibold text-sidebar-text focus-visible:outline-sidebar-focus"
          >
            <BlekkLogoMark />
            <span v-if="!collapsed" class="text-card-title">{{ $t('brand.name') }}</span>
            <span class="sr-only">{{ $t('shell.home') }}</span>
          </NuxtLink>
        </template>

        <template #default="{ collapsed }">
          <ShellSiteCard :collapsed="collapsed" />
          <ShellMenu :collapsed="collapsed" />
        </template>

        <template #footer="{ collapsed }">
          <ShellUserMenu :collapsed="collapsed" />
        </template>
      </UDashboardSidebar>

      <main id="main-content" ref="main" tabindex="-1" class="flex min-w-0 flex-1 bg-app outline-none">
        <slot />
      </main>
    </UDashboardGroup>
  </div>
</template>
