<script setup lang="ts">
// The editor's own frame (M2.1, «Blekk», docs/design/blekk/Editor.dc.html): the whole window for the writing, without the side menu;
// the editor brings its narrow top bar with the way back to its list. As the dashboard layout: the site's name, the account's colour
// scheme, the skip link and focus on the main region after a change of page. A page picks it with
// `definePageMeta({ layout: 'editor', middleware: 'signed-in' })`.
const router = useRouter()
await useAuthOptions()
useAdminColorScheme().follow()

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
  <div class="min-h-dvh bg-sunken lg:fixed lg:inset-0 lg:flex lg:flex-col">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-field focus:bg-surface focus:px-4 focus:py-3 focus:text-highlighted"
      @click.prevent="main?.focus()"
    >
      {{ $t('shell.skipToContent') }}
    </a>
    <main id="main-content" ref="main" tabindex="-1" class="flex min-h-0 flex-1 flex-col outline-none">
      <slot />
    </main>
  </div>
</template>
