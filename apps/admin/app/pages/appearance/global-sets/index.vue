<script setup lang="ts">
// «Utseende → Globale sett» (K-106): the site's named block collections («Kontaktinfo», «Bunntekst»), for the whole site. The sets
// the active theme names in theme.json (`globalSets`) are made empty here when there is none of the slug. Needs `edit_theme_options`.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
const appearanceApi = useAppearanceApi()
const activeTheme = useActiveTheme()
const confirm = useConfirmDialog()
useSeoMeta({ title: () => t('appearance.sets.title') })

const mayEdit = computed(
  () =>
    auth.session.value.status === 'authenticated' &&
    auth.session.value.account.capabilities.includes('edit_theme_options'),
)
if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}
const { data, error, refresh } = await useAsyncData('appearance:global-sets', () => appearanceApi.globalSets(), {
  enabled: mayEdit,
})
const failure = ref<string>()

// The theme's expected sets, made once the list and the theme are known.
const making = ref(false)
watch(
  [data, activeTheme],
  async ([list, theme]) => {
    // In the browser only: a page view on the server changes nothing.
    if (import.meta.server || !list || !theme || making.value) return
    const missing = theme.globalSets.filter((set) => !list.items.some((item) => item.slug === set.slug))
    if (missing.length === 0) return
    making.value = true
    try {
      for (const set of missing) await appearanceApi.createGlobalSet({ name: set.name, slug: set.slug })
      await refresh()
    } catch (caught) {
      failure.value = describeApiError(caught, t)
    } finally {
      making.value = false
    }
  },
  { immediate: true },
)

const name = ref('')
async function create(): Promise<void> {
  if (name.value.trim() === '') return
  try {
    const created = await appearanceApi.createGlobalSet({ name: name.value.trim() })
    await navigateTo(`/appearance/global-sets/${created.id}`)
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}
async function remove(id: string, setName: string, slug: string): Promise<void> {
  const ok = await confirm.ask({
    title: t('appearance.sets.delete'),
    description: expected(slug)
      ? t('appearance.sets.deleteThemeConfirm', { name: setName })
      : t('appearance.sets.deleteConfirm', { name: setName }),
    confirmLabel: t('appearance.sets.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!ok) return
  try {
    await appearanceApi.deleteGlobalSet(id)
    await refresh()
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  }
}
const expected = (slug: string) => activeTheme.value?.globalSets.some((set) => set.slug === slug) === true
</script>

<template>
  <UDashboardPanel id="appearance-global-sets">
    <template #header>
      <UDashboardNavbar :title="$t('appearance.sets.title')" />
    </template>
    <template #body>
      <section v-if="!mayEdit" aria-labelledby="sets-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="sets-denied" class="text-xl font-semibold text-highlighted">{{ $t('appearance.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <div v-else class="flex max-w-3xl flex-col gap-6">
        <p class="text-base text-default">{{ $t('appearance.sets.intro') }}</p>
        <UAlert
          v-if="failure || error"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('appearance.sets.failed')"
          :description="failure"
        />
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="create">
          <UFormField :label="$t('appearance.sets.newName')" name="set-name">
            <UInput v-model="name" maxlength="200" size="xl" class="w-full sm:w-72" />
          </UFormField>
          <UButton type="submit" size="lg" class="min-h-11">{{ $t('appearance.sets.create') }}</UButton>
        </form>
        <p v-if="data && data.items.length === 0" class="text-sm text-muted">{{ $t('appearance.sets.empty') }}</p>
        <ul v-else-if="data" class="flex flex-col divide-y divide-default rounded border border-default">
          <li v-for="item in data.items" :key="item.id" class="flex flex-wrap items-center gap-3 p-3">
            <NuxtLink :to="`/appearance/global-sets/${item.id}`" class="font-semibold text-primary underline">{{
              item.name
            }}</NuxtLink>
            <code class="text-sm text-muted">{{ item.slug }}</code>
            <UBadge v-if="expected(item.slug)" color="neutral" variant="subtle">{{
              $t('appearance.sets.fromTheme')
            }}</UBadge>
            <UButton
              color="error"
              variant="ghost"
              size="sm"
              class="ms-auto min-h-11"
              :aria-label="$t('appearance.sets.deleteNamed', { name: item.name })"
              @click="remove(item.id, item.name, item.slug)"
              >{{ $t('appearance.sets.delete') }}</UButton
            >
          </li>
        </ul>
      </div>
    </template>
  </UDashboardPanel>
</template>
