<script setup lang="ts">
import type { ReadingSettings } from '@toascribe/shared'

// «Innstillinger → Lesing» (K-194, K-226; WordPress' options-reading.php): what the front page shows, posts per page, the feed (it
// comes in M1.6) and «Søkemotorsynlighet». The page choices are the published pages.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const settingsApi = useSettingsApi()
useSeoMeta({ title: () => t('settings.reading.title') })

const screen = useSettingsScreen<ReadingSettings, Awaited<ReturnType<typeof settingsApi.reading>>>({
  key: 'settings:reading',
  load: settingsApi.reading,
  save: (changes) => settingsApi.updateReading(changes),
})
const { form, data } = screen
const { data: pages } = usePageChoices('reading', 'publish')
const NONE = '__none__'
const withNone = computed(() => [{ label: t('settings.reading.choose'), value: NONE }, ...pages.value])
const pageModel = (key: 'page_on_front' | 'page_for_posts') =>
  computed({
    get: () => form.value[key] ?? NONE,
    set: (value: string) => {
      form.value[key] = value === NONE ? null : value
    },
  })
const frontPage = pageModel('page_on_front')
const postsPage = pageModel('page_for_posts')
const shows = computed(() => [
  { label: t('settings.reading.latestPosts'), value: 'posts' },
  { label: t('settings.reading.staticPage'), value: 'page' },
])
const feedKinds = computed(() => [
  { label: t('settings.reading.feedFull'), value: false },
  { label: t('settings.reading.feedExcerpt'), value: true },
])
const discourage = computed({
  get: () => !form.value.blog_public,
  set: (value: boolean | 'indeterminate') => {
    form.value.blog_public = value !== true
  },
})
</script>

<template>
  <SettingsScreen
    id="settings-reading"
    :title="$t('settings.reading.title')"
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
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.reading.frontShows') }}</legend>
        <URadioGroup v-model="form.show_on_front" :items="shows" />
        <div v-if="form.show_on_front === 'page'" class="flex flex-col gap-3 ps-6">
          <UFormField :label="$t('settings.reading.frontPage')" name="page_on_front">
            <USelect v-model="frontPage" :items="withNone" size="xl" class="w-full sm:w-80" />
          </UFormField>
          <UFormField :label="$t('settings.reading.postsPage')" name="page_for_posts">
            <USelect v-model="postsPage" :items="withNone" size="xl" class="w-full sm:w-80" />
          </UFormField>
        </div>
      </fieldset>
      <UFormField :label="$t('settings.reading.postsPerPage')" name="posts_per_page">
        <UInput v-model.number="form.posts_per_page" type="number" min="1" max="100" size="xl" class="w-full sm:w-40" />
      </UFormField>
      <UFormField :label="$t('settings.reading.postsPerRss')" name="posts_per_rss">
        <UInput v-model.number="form.posts_per_rss" type="number" min="1" max="100" size="xl" class="w-full sm:w-40" />
      </UFormField>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.reading.feedShows') }}</legend>
        <URadioGroup v-model="form.rss_use_excerpt" :items="feedKinds" />
      </fieldset>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.reading.visibility') }}</legend>
        <UCheckbox v-model="discourage" :label="$t('settings.reading.discourage')" />
        <p class="text-sm text-toned">{{ $t('settings.reading.discourageHelp') }}</p>
      </fieldset>
    </template>
  </SettingsScreen>
</template>
