<script setup lang="ts">
// «Verktøy → Nettstedshelse → Info» (M1.7, K-203; WordPress' site-health.php?tab=debug): facts about the install in groups, and
// «Kopier til utklippstavlen», the same facts as plain text for support, where the api has replaced e-mail addresses, addresses,
// paths and anything that looks like a token with [skjult]. No field holds a secret.
import type { SiteHealthField } from '@toascribe/shared'

definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t, te, locale } = useI18n()
const api = useSiteToolsApi()
const auth = useAuth()
useSeoMeta({ title: () => t('siteHealth.title') })

const mayManage = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('manage_options'),
)
if (import.meta.server && !mayManage.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}
const { data, error, refresh } = await useAsyncData('site-health-info', api.healthInfo, { enabled: mayManage })

function shown(field: SiteHealthField): string {
  const value = field.value
  if (value === null) return t('siteHealth.none')
  switch (field.kind) {
    case 'bytes':
      return formatBytes(Number(value), locale.value)
    case 'datetime':
      return `${new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(String(value)))} UTC`
    case 'boolean':
      return value === true ? t('siteHealth.yes') : t('siteHealth.no')
    case 'number':
      return new Intl.NumberFormat(locale.value).format(Number(value))
    case 'word':
      return siteHealthWord(translator, String(value))
    default:
      return String(value)
  }
}
const translator = { t, te }
const label = (group: string, key: string) => siteHealthField(translator, group, key)

const notice = ref<'copied' | 'failed'>()
async function copy(): Promise<void> {
  if (!data.value) return
  try {
    await navigator.clipboard.writeText(data.value.text)
    notice.value = 'copied'
  } catch {
    // No clipboard (plain http on a LAN address, or refused): the facts are on screen to select by hand.
    notice.value = 'failed'
  }
}
</script>

<template>
  <UDashboardPanel id="site-health">
    <template #header>
      <UDashboardNavbar :title="$t('siteHealth.title')" />
    </template>
    <template #body>
      <section v-if="!mayManage" aria-labelledby="site-health-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="site-health-denied" class="text-xl font-semibold text-highlighted">{{ $t('settings.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('siteHealth.loadFailed')"
        :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
      />
      <div v-else-if="data" class="flex max-w-3xl flex-col gap-6">
        <h2 class="text-xl font-semibold text-highlighted">{{ $t('siteHealth.info') }}</h2>
        <p class="max-w-prose text-base text-default">{{ $t('siteHealth.intro') }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            class="min-h-11"
            icon="i-lucide-clipboard-copy"
            :label="$t('siteHealth.copy')"
            @click="copy"
          />
          <p role="status" class="text-sm text-toned">
            <template v-if="notice === 'copied'">{{ $t('siteHealth.copied') }}</template>
            <template v-else-if="notice === 'failed'">{{ $t('siteHealth.copyFailed') }}</template>
          </p>
        </div>
        <section
          v-for="group in data.groups"
          :key="group.key"
          :aria-labelledby="`site-health-${group.key}`"
          class="flex flex-col gap-2"
        >
          <h3 :id="`site-health-${group.key}`" class="text-lg font-semibold text-highlighted">
            {{ siteHealthGroup(translator, group.key) }}
          </h3>
          <dl class="divide-y divide-default rounded-md border border-default">
            <div
              v-for="field in group.fields"
              :key="field.key"
              class="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
            >
              <dt class="text-sm font-medium text-toned">{{ label(group.key, field.key) }}</dt>
              <dd class="text-base break-words text-default">{{ shown(field) }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
