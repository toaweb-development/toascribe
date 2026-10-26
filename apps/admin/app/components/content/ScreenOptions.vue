<script setup lang="ts">
import { CONTENT_LIST_COLUMNS } from '@toascribe/shared'
import type { ContentListColumn, ListScreenOptions } from '@toascribe/shared'

// «Skjermalternativer» (K-037): which columns the list shows and how many items a page has, saved in the account's preferences
// (`postsScreen` / `pagesScreen`) so they follow the account to every device. Opened by the list (useOverlay); `save` answers with an
// error text or nothing.
const props = defineProps<{
  options: ListScreenOptions
  save: (options: ListScreenOptions) => Promise<string | undefined>
}>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const { t } = useI18n()

const shown = ref<ContentListColumn[]>(
  CONTENT_LIST_COLUMNS.filter((column) => !props.options.hiddenColumns.includes(column)),
)
const perPage = ref(String(props.options.perPage))
const saving = ref(false)
const failure = ref<string>()

const columnLabel = (column: ContentListColumn) =>
  column === 'author' ? t('content.columns.author') : t('content.columns.date')

const perPageValid = computed(
  () => /^\d{1,3}$/.test(perPage.value) && Number(perPage.value) >= 1 && Number(perPage.value) <= 100,
)

function toggle(column: ContentListColumn, on: boolean | 'indeterminate') {
  shown.value = on === true ? [...new Set([...shown.value, column])] : shown.value.filter((entry) => entry !== column)
}

async function submit() {
  if (saving.value || !perPageValid.value) return
  saving.value = true
  failure.value = undefined
  try {
    failure.value = await props.save({
      hiddenColumns: CONTENT_LIST_COLUMNS.filter((column) => !shown.value.includes(column)),
      perPage: Number(perPage.value),
    })
    if (failure.value === undefined) emit('close', true)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal :title="$t('content.screenOptions.title')" :ui="{ footer: 'justify-end' }">
    <template #body>
      <form id="screen-options" class="flex flex-col gap-5" @submit.prevent="submit">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 font-medium text-default">{{ $t('content.screenOptions.columns') }}</legend>
          <UCheckbox
            v-for="column in CONTENT_LIST_COLUMNS"
            :key="column"
            size="lg"
            :model-value="shown.includes(column)"
            :label="columnLabel(column)"
            @update:model-value="toggle(column, $event)"
          />
        </fieldset>
        <UFormField
          :label="$t('content.screenOptions.perPage')"
          name="perPage"
          :error="perPageValid ? undefined : $t('content.screenOptions.perPageInvalid')"
        >
          <UInput v-model="perPage" type="number" inputmode="numeric" min="1" max="100" size="xl" class="w-32" />
        </UFormField>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('content.screenOptions.failed')"
          :description="failure"
        />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', false)">
        {{ $t('content.quickEdit.cancel') }}
      </UButton>
      <UButton type="submit" form="screen-options" size="lg" class="min-h-11" :loading="saving">
        {{ $t('content.screenOptions.apply') }}
      </UButton>
    </template>
  </UModal>
</template>
