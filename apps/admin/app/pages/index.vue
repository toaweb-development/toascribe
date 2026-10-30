<script setup lang="ts">
// The dashboard, «Kontrollpanel» (WordPress' wp-admin/index.php), drawn as «Blekk» (M2.1, docs/design/blekk/Main.dc.html): a greeting
// with the date in the site's time zone and the two main actions, the notices in one box, the counts as cards, «Hurtigutkast» and
// «Aktivitet» on the left for accounts that write posts, «Nettstedshelse» and «Versjon» on the right. Each part loads and fails by
// itself, so one that cannot load does not take the others with it.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t, locale } = useI18n()
const auth = useAuth()
const adminApi = useAdminApi()
useSeoMeta({ title: () => t('dashboard.title') })

const can = (capability: string) =>
  auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes(capability)
const writes = computed(() => can('edit_posts'))
const manages = computed(() => can('manage_options'))

const glance = await useAsyncData('dashboard:glance', () => adminApi.glance())

const name = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.displayName : '',
)
// The server renders the hour it is there, in the site's zone, and so does the browser: the same text unless the hour turns between.
const now = new Date()
const timeZone = computed(() => glance.data.value?.timeZone ?? 'UTC')
const heading = computed(() => {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timeZone.value }).format(now),
  )
  return GREETINGS[greetingPart(hour)](t, name.value)
})
const today = computed(() => {
  const text = new Intl.DateTimeFormat(locale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timeZone.value,
  }).format(now)
  return text.charAt(0).toLocaleUpperCase(locale.value) + text.slice(1)
})
</script>

<template>
  <AdminPage id="dashboard" :title="$t('dashboard.title')" :heading="heading" :eyebrow="today">
    <template #actions>
      <UButton to="/" external color="neutral" variant="outline" size="xl" class="min-h-control-main">
        {{ $t('dashboard.actions.visit') }}
      </UButton>
      <UButton v-if="writes" to="/posts/new" size="xl" class="min-h-control-main">
        {{ $t('dashboard.actions.write') }}
      </UButton>
    </template>

    <DashboardNotices />
    <DashboardStats
      :glance="glance.data.value"
      :glance-pending="glance.status.value === 'pending'"
      :glance-failed="Boolean(glance.error.value)"
    />
    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      <div v-if="writes" class="flex min-w-0 flex-col gap-6">
        <DashboardQuickDraft />
        <DashboardActivity />
      </div>
      <div class="flex min-w-0 flex-col gap-6" :class="writes ? '' : 'lg:col-span-2'">
        <DashboardHealth v-if="manages" />
        <DashboardVersion :version="glance.data.value?.version" />
      </div>
    </div>
  </AdminPage>
</template>
