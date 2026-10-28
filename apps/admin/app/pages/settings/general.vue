<script setup lang="ts">
import { DEFAULT_ROLES } from '@toascribe/shared'
import type { GeneralSettings } from '@toascribe/shared'

// «Innstillinger → Generelt» (K-191; WordPress' options-general.php). The site's address is PUBLIC_ORIGIN and only shown. A new
// administrator address is used only after the link sent to it is opened (K-192), so it is asked for in a field of its own.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t, locale } = useI18n()
const settingsApi = useSettingsApi()
useSeoMeta({ title: () => t('settings.general.title') })

const screen = await useSettingsScreen<GeneralSettings, Awaited<ReturnType<typeof settingsApi.general>>>({
  key: 'settings:general',
  load: settingsApi.general,
  save: (changes) => settingsApi.updateGeneral(changes),
})
const { form, data } = screen
const newAdminEmail = ref('')

async function save(): Promise<void> {
  const next = newAdminEmail.value.trim()
  const { admin_email: _adminEmail, ...rest } = form.value
  form.value = { ...rest, admin_email: data.value?.settings.admin_email ?? null }
  if (await screen.save(next === '' ? {} : { new_admin_email: next })) newAdminEmail.value = ''
}

const roles = computed(() =>
  DEFAULT_ROLES.filter((role) => role.slug !== 'administrator').map((role) => ({
    label: roleLabel(t, role.slug, undefined),
    value: role.slug as string,
  })),
)
const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')].map((zone) => ({ label: zone, value: zone }))
const days = computed(() =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    label: new Intl.DateTimeFormat(locale.value, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 7 + day)),
    ),
    value: day,
  })),
)
</script>

<template>
  <SettingsScreen
    id="settings-general"
    :title="$t('settings.general.title')"
    :may-manage="screen.mayManage.value"
    :loaded="data !== null && data !== undefined"
    :failed="screen.error.value !== undefined && screen.error.value !== null"
    :saving="screen.saving.value"
    :report="screen.report.value"
    :failure="screen.failure.value"
    @save="save"
    @retry="screen.refresh()"
  >
    <template v-if="data">
      <UFormField :label="$t('settings.general.blogname')" name="blogname">
        <UInput v-model="form.blogname" maxlength="200" size="xl" class="w-full" />
      </UFormField>
      <UFormField
        :label="$t('settings.general.tagline')"
        :help="$t('settings.general.taglineHelp')"
        name="blogdescription"
      >
        <UInput v-model="form.blogdescription" maxlength="500" size="xl" class="w-full" />
      </UFormField>
      <UFormField :label="$t('settings.general.siteUrl')" :help="$t('settings.general.siteUrlHelp')" name="site_url">
        <UInput :model-value="data.siteUrl" readonly size="xl" class="w-full" />
      </UFormField>
      <UFormField
        :label="$t('settings.general.adminEmail')"
        :help="$t('settings.general.adminEmailHelp', { email: data.settings.admin_email ?? '–' })"
        name="new_admin_email"
      >
        <UInput v-model="newAdminEmail" type="email" autocomplete="email" size="xl" class="w-full" />
      </UFormField>
      <p v-if="data.pendingAdminEmail" class="text-sm text-warning" role="status">
        {{ $t('settings.general.adminEmailPending', { email: data.pendingAdminEmail }) }}
      </p>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.general.membership') }}</legend>
        <UCheckbox v-model="form.users_can_register" :label="$t('settings.general.anyoneCanRegister')" />
      </fieldset>
      <UFormField :label="$t('settings.general.defaultRole')" name="default_role">
        <USelect v-model="form.default_role" :items="roles" size="xl" class="w-full sm:w-72" />
      </UFormField>
      <UFormField :label="$t('settings.general.locale')" name="locale">
        <USelect
          v-model="form.locale"
          :items="data.locales.map((locale) => ({ label: locale.name, value: locale.code }))"
          size="xl"
          class="w-full sm:w-72"
        />
      </UFormField>
      <UFormField :label="$t('settings.general.timezone')" name="timezone_string">
        <USelectMenu v-model="form.timezone_string" :items="zones" value-key="value" size="xl" class="w-full sm:w-72" />
      </UFormField>
      <UFormField
        :label="$t('settings.general.dateFormat')"
        :help="$t('settings.general.dateFormatHelp')"
        name="date_format"
      >
        <UInput v-model="form.date_format" maxlength="100" size="xl" class="w-full sm:w-72" />
      </UFormField>
      <UFormField
        :label="$t('settings.general.timeFormat')"
        :help="$t('settings.general.timeFormatHelp')"
        name="time_format"
      >
        <UInput v-model="form.time_format" maxlength="100" size="xl" class="w-full sm:w-72" />
      </UFormField>
      <UFormField :label="$t('settings.general.startOfWeek')" name="start_of_week">
        <USelect v-model="form.start_of_week" :items="days" size="xl" class="w-full sm:w-72" />
      </UFormField>
    </template>
  </SettingsScreen>
</template>
