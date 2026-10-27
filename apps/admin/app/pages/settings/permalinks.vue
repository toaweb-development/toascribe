<script setup lang="ts">
import { DEFAULT_CATEGORY_BASE, DEFAULT_TAG_BASE, PERMALINK_PRESETS, postPath } from '@toascribe/shared'
import type { PermalinkPreset, PermalinkSettings } from '@toascribe/shared'

// «Innstillinger → Permalenker» (K-197, K-221; WordPress' options-permalink.php): the common structures with an example address each,
// «Egendefinert» with the tags as buttons, and the category and tag bases. Old addresses keep working after a change: the site sends
// them on to the new ones with 301 (K-207).
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const settingsApi = useSettingsApi()
useSeoMeta({ title: () => t('settings.permalinks.title') })

const screen = await useSettingsScreen<PermalinkSettings, Awaited<ReturnType<typeof settingsApi.permalinks>>>({
  key: 'settings:permalinks',
  load: settingsApi.permalinks,
  save: (changes) => settingsApi.updatePermalinks(changes),
})
const { form, data } = screen

const PRESETS = ['plain', 'day', 'month', 'numeric', 'postname'] as const satisfies readonly PermalinkPreset[]
const CUSTOM = 'custom'
const TAGS = [
  '%year%',
  '%monthnum%',
  '%day%',
  '%hour%',
  '%minute%',
  '%second%',
  '%post_id%',
  '%postname%',
  '%category%',
  '%author%',
] as const
const origin = useRequestURL().origin
const SAMPLE = {
  shortId: 123,
  slug: 'eksempel-innlegg',
  year: '2026',
  monthnum: '10',
  day: '27',
  hour: '14',
  minute: '30',
  second: '00',
  category: 'nyheter',
  author: 'admin',
}
const example = (structure: string) => `${origin}${postPath(structure, SAMPLE)}`
const presetLabel = (preset: (typeof PRESETS)[number]) =>
  preset === 'plain'
    ? t('settings.permalinks.plain')
    : preset === 'day'
      ? t('settings.permalinks.day')
      : preset === 'month'
        ? t('settings.permalinks.month')
        : preset === 'numeric'
          ? t('settings.permalinks.numeric')
          : t('settings.permalinks.postname')

const choice = computed({
  get: () => PRESETS.find((preset) => PERMALINK_PRESETS[preset] === form.value.permalink_structure) ?? CUSTOM,
  set: (value: string) => {
    const preset = PRESETS.find((entry) => entry === value)
    if (preset !== undefined) form.value.permalink_structure = PERMALINK_PRESETS[preset]
  },
})
const items = computed(() => [
  ...PRESETS.map((preset) => ({
    value: preset,
    label: presetLabel(preset),
    description: example(PERMALINK_PRESETS[preset]),
  })),
  { value: CUSTOM, label: t('settings.permalinks.custom') },
])
function addTag(tag: string): void {
  const current = form.value.permalink_structure
  if (current.includes(tag)) return
  form.value.permalink_structure = `${current === '' ? '/' : current.replace(/\/?$/, '/')}${tag}/`
}
</script>

<template>
  <SettingsScreen
    id="settings-permalinks"
    :title="$t('settings.permalinks.title')"
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
      <p class="max-w-prose text-base text-default">{{ $t('settings.permalinks.intro') }}</p>
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.permalinks.common') }}</legend>
        <URadioGroup v-model="choice" :items="items" />
        <UFormField
          :label="$t('settings.permalinks.structure')"
          :help="$t('settings.permalinks.structureHelp')"
          name="permalink_structure"
        >
          <UInput v-model="form.permalink_structure" maxlength="255" size="xl" class="w-full font-mono" />
        </UFormField>
        <div class="flex flex-wrap gap-2" role="group" :aria-label="$t('settings.permalinks.tags')">
          <UButton
            v-for="tag in TAGS"
            :key="tag"
            color="neutral"
            variant="outline"
            size="sm"
            class="min-h-11 font-mono"
            :label="tag"
            :aria-pressed="form.permalink_structure.includes(tag)"
            @click="addTag(tag)"
          />
        </div>
      </fieldset>
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-2 font-semibold text-highlighted">{{ $t('settings.permalinks.optional') }}</legend>
        <p class="text-sm text-toned">{{ $t('settings.permalinks.optionalHelp') }}</p>
        <UFormField :label="$t('settings.permalinks.categoryBase')" name="category_base">
          <UInput
            v-model="form.category_base"
            :placeholder="DEFAULT_CATEGORY_BASE"
            maxlength="200"
            size="xl"
            class="w-full sm:w-80"
          />
        </UFormField>
        <UFormField :label="$t('settings.permalinks.tagBase')" name="tag_base">
          <UInput
            v-model="form.tag_base"
            :placeholder="DEFAULT_TAG_BASE"
            maxlength="200"
            size="xl"
            class="w-full sm:w-80"
          />
        </UFormField>
      </fieldset>
    </template>
  </SettingsScreen>
</template>
