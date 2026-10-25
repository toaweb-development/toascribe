<script setup lang="ts">
// The shell of every signed-in admin page (nuxt-vue §4.1, ui-system §3.3): the bar across the top, the sidebar with the menu and, to
// the right of it, the page, which brings its own `UDashboardPanel` with its navbar. The sign-in screens and the setup wizard have
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
  <div class="fixed inset-0 flex flex-col">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-default focus:px-4 focus:py-3 focus:text-highlighted focus:ring-2 focus:ring-primary"
      @click.prevent="main?.focus()"
    >
      {{ $t('shell.skipToContent') }}
    </a>

    <ShellAdminBar />

    <UDashboardGroup unit="rem" class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar id="admin" collapsible>
        <template #header>
          <UDashboardSidebarCollapse class="ms-auto" />
        </template>

        <template #default="{ collapsed }">
          <ShellMenu :collapsed="collapsed" />
        </template>
      </UDashboardSidebar>

      <main id="main-content" ref="main" tabindex="-1" class="flex min-w-0 flex-1 outline-none">
        <slot />
      </main>
    </UDashboardGroup>
  </div>
</template>
