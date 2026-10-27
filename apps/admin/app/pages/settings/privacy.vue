<script setup lang="ts">
import type { PrivacySettings } from '@toascribe/shared'

// «Innstillinger → Personvern» (K-198; WordPress' options-privacy.php): which page is the privacy policy, or a new one. The site
// links it in the footer and on the registration form once it is published (K-199).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const settingsApi = useSettingsApi()
const contentApi = useContentApi()
useSeoMeta({ title: () => t('settings.privacy.title') })

const screen = await useSettingsScreen<PrivacySettings, Awaited<ReturnType<typeof settingsApi.privacy>>>({
  key: 'settings:privacy',
  load: settingsApi.privacy,
  save: (changes) => settingsApi.updatePrivacy(changes),
})
const { form, data } = screen
const { data: pages, refresh: refreshPages } = await usePageChoices('privacy', 'all')
const NONE = '__none__'
const choices = computed(() => [{ label: t('settings.reading.choose'), value: NONE }, ...pages.value])
const page = computed({
  get: () => form.value.wp_page_for_privacy_policy ?? NONE,
  set: (value: string) => {
    form.value.wp_page_for_privacy_policy = value === NONE ? null : value
  },
})

const creating = ref(false)
/** «Opprett»: a new draft page, chosen at once, opened in the editor (WordPress makes it from its template). */
async function createPage(): Promise<void> {
  creating.value = true
  try {
    const created = await contentApi.create({ type: 'page', title: t('settings.privacy.newTitle') })
    await refreshPages()
    form.value.wp_page_for_privacy_policy = created.id
    if (await screen.save()) await navigateTo(`/pages/${created.id}`)
  } catch (caught) {
    screen.failure.value = describeApiError(caught, t)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <SettingsScreen
    id="settings-privacy"
    :title="$t('settings.privacy.title')"
    :may-manage="screen.mayManage.value"
    :loaded="data !== null && data !== undefined"
    :failed="screen.error.value !== undefined && screen.error.value !== null"
    :saving="screen.saving.value"
    :report="screen.report.value"
    :failure="screen.failure.value"
    @save="screen.save()"
    @retry="screen.refresh()"
  >
    <template v-if="data">
      <p class="max-w-prose text-base text-default">{{ $t('settings.privacy.intro') }}</p>
      <UFormField
        :label="$t('settings.privacy.page')"
        :help="$t('settings.privacy.pageHelp')"
        name="wp_page_for_privacy_policy"
      >
        <USelect v-model="page" :items="choices" size="xl" class="w-full sm:w-80" />
      </UFormField>
      <div>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          class="min-h-11"
          icon="i-lucide-file-plus"
          :loading="creating"
          :label="$t('settings.privacy.create')"
          @click="createPage"
        />
      </div>
    </template>
  </SettingsScreen>
</template>
