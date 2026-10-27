<script setup lang="ts">
// «Kontrollpanel → Oppdateringer» (M1.7, K-290; WordPress' update-core.php): the version that runs, the newest release the last
// check found, and the command to update on the host (the admin cannot update containers). The daily check can be turned off here;
// TOASCRIBE_UPDATE_CHECK=off on the server turns it off whatever this says.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t, locale } = useI18n()
const api = useSiteToolsApi()
const auth = useAuth()
useSeoMeta({ title: () => t('updates.title') })

const mayUpdate = computed(
  () =>
    auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes('update_core'),
)
if (import.meta.server && !mayUpdate.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}
const { data, error, refresh } = await useAsyncData('updates', api.updates, { enabled: mayUpdate })

const when = (iso: string) =>
  `${new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso))} UTC`

const saving = ref(false)
const failure = ref<string>()
const enabled = computed({
  get: () => data.value?.enabled ?? true,
  set: (value: boolean) => {
    void save(value)
  },
})
async function save(value: boolean): Promise<void> {
  saving.value = true
  failure.value = undefined
  try {
    data.value = await api.updateUpdates({ enabled: value })
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="updates">
    <template #header>
      <UDashboardNavbar :title="$t('updates.title')" />
    </template>
    <template #body>
      <section v-if="!mayUpdate" aria-labelledby="updates-denied" class="flex max-w-prose flex-col gap-3">
        <h2 id="updates-denied" class="text-xl font-semibold text-highlighted">{{ $t('settings.denied') }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="$t('updates.loadFailed')"
        :actions="[{ label: $t('content.failed.retry'), onClick: () => refresh() }]"
      />
      <div v-else-if="data" class="flex max-w-3xl flex-col gap-8">
        <section aria-labelledby="updates-version" class="flex flex-col gap-3">
          <h2 id="updates-version" class="text-lg font-semibold text-highlighted">
            {{ $t('updates.current', { version: data.current }) }}
          </h2>
          <p v-if="data.status" class="text-sm text-toned">
            {{ $t('updates.checkedAt', { time: when(data.status.checkedAt) }) }}
          </p>
          <UAlert
            v-if="data.status === null"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            :title="$t('updates.never')"
          />
          <UAlert
            v-else-if="!data.status.ok"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="$t('updates.failed')"
          />
          <UAlert
            v-else-if="data.status.available"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="$t('updates.available', { version: data.status.latest ?? '' })"
          />
          <UAlert v-else color="success" variant="subtle" icon="i-lucide-circle-check" :title="$t('updates.newest')" />
          <p v-if="data.changelogUrl">
            <ULink :to="data.changelogUrl" target="_blank" rel="noopener noreferrer" class="underline text-primary">
              {{ $t('updates.changelog', { version: data.status?.latest ?? '' }) }}
            </ULink>
          </p>
        </section>

        <section aria-labelledby="updates-how" class="flex flex-col gap-3">
          <h2 id="updates-how" class="text-lg font-semibold text-highlighted">{{ $t('updates.howTitle') }}</h2>
          <p class="max-w-prose text-base text-default">{{ $t('updates.how') }}</p>
          <pre
            class="overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm text-highlighted"
            data-testid="update-command"
          ><code>{{ $t('updates.command') }}</code></pre>
          <p class="max-w-prose text-sm text-toned">{{ $t('updates.backupNote') }}</p>
        </section>

        <section aria-labelledby="updates-check" class="flex flex-col gap-3">
          <h2 id="updates-check" class="text-lg font-semibold text-highlighted">{{ $t('updates.checkTitle') }}</h2>
          <USwitch
            v-model="enabled"
            :disabled="saving || data.disabledByServer"
            :label="$t('updates.checkLabel')"
            :description="$t('updates.checkHelp')"
          />
          <UAlert
            v-if="data.disabledByServer"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            :title="$t('updates.offByServer')"
          />
          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('settings.saveFailed')"
            :description="failure"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
