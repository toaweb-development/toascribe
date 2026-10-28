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

// «Innbygginger» (M1.6, K-225): a player from another service waits for a click, and the Mastodon instances embeds may come from,
// one host name per line (the api checks each and keeps them sorted).
const clickToLoad = computed({
  get: () => form.value.embed_click_to_load,
  set: (value: boolean | 'indeterminate') => {
    form.value.embed_click_to_load = value === true
  },
})
const instances = computed({
  get: () => (form.value.oembed_mastodon_instances ?? []).join('\n'),
  set: (value: string) => {
    form.value.oembed_mastodon_instances = value
      .split(/\s+/)
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== '')
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
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.privacy.embeds') }}</legend>
        <UCheckbox v-model="clickToLoad" :label="$t('settings.privacy.clickToLoad')" />
        <p class="max-w-prose text-sm text-toned">{{ $t('settings.privacy.clickToLoadHelp') }}</p>
        <UFormField
          :label="$t('settings.privacy.mastodon')"
          :help="$t('settings.privacy.mastodonHelp')"
          name="oembed_mastodon_instances"
        >
          <UTextarea v-model="instances" :rows="4" autoresize spellcheck="false" class="w-full sm:w-80 font-mono" />
        </UFormField>
      </fieldset>
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.privacy.security') }}</legend>
        <p class="max-w-prose text-sm text-toned">{{ $t('settings.privacy.securityHelp') }}</p>
        <UFormField
          :label="$t('settings.privacy.securityContact')"
          :help="$t('settings.privacy.securityContactHelp')"
          name="security_contact"
        >
          <UInput v-model="form.security_contact" size="xl" spellcheck="false" class="w-full sm:w-96" />
        </UFormField>
        <UFormField :label="$t('settings.privacy.securityPolicy')" name="security_policy">
          <UInput v-model="form.security_policy" type="url" size="xl" spellcheck="false" class="w-full sm:w-96" />
        </UFormField>
      </fieldset>
    </template>
  </SettingsScreen>
</template>
