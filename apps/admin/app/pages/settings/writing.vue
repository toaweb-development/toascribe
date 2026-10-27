<script setup lang="ts">
import type { WritingSettings } from '@toascribe/shared'

// «Innstillinger → Skriving» (K-193; WordPress' options-writing.php): the default category and post format. Post by e-mail and the
// update services are left out (PLAN).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const settingsApi = useSettingsApi()
const termsApi = useTermsApi()
useSeoMeta({ title: () => t('settings.writing.title') })

const screen = await useSettingsScreen<WritingSettings, Awaited<ReturnType<typeof settingsApi.writing>>>({
  key: 'settings:writing',
  load: settingsApi.writing,
  save: (changes) => settingsApi.updateWriting(changes),
})
const { form, data } = screen
const { data: categories } = await useAsyncData(
  'settings:writing:categories',
  async () =>
    (await termsApi.all('category')).map((term) => ({
      label: `${'— '.repeat(term.depth)}${term.name}`,
      value: term.id,
    })),
  { default: () => [] as { label: string; value: string }[] },
)
const category = computed({
  get: () => form.value.default_category ?? undefined,
  set: (value: string | undefined) => {
    if (value !== undefined) form.value.default_category = value
  },
})
const formats = computed(() => [{ label: t('settings.writing.formatStandard'), value: 'standard' }])
</script>

<template>
  <SettingsScreen
    id="settings-writing"
    :title="$t('settings.writing.title')"
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
      <UFormField :label="$t('settings.writing.defaultCategory')" name="default_category">
        <USelect v-model="category" :items="categories" size="xl" class="w-full sm:w-80" />
      </UFormField>
      <UFormField :label="$t('settings.writing.defaultFormat')" name="default_post_format">
        <USelect v-model="form.default_post_format" :items="formats" size="xl" class="w-full sm:w-80" />
      </UFormField>
    </template>
  </SettingsScreen>
</template>
