<script setup lang="ts">
import { TERM_NAME_MAX_LENGTH } from '@toascribe/shared'
import type { BuiltInTaxonomy, TermItem, UpdateTermRequest } from '@toascribe/shared'

// «Rediger» and «Hurtigrediger» of a term (WordPress' term edit screen and inline edit): quick edit has the name and the slug, edit
// also the parent (categories) and the description. Only what changed is sent; `save` answers with an error text or nothing.
const props = defineProps<{
  term: TermItem
  taxonomy: BuiltInTaxonomy
  quick: boolean
  /** The categories it can be put under (without itself and the ones below it). */
  parents: readonly TermItem[]
  save: (request: UpdateTermRequest) => Promise<string | undefined>
}>()

const emit = defineEmits<{ close: [saved: boolean] }>()
const { t } = useI18n()

const NO_PARENT = 'none'
const name = ref(props.term.name)
const slug = ref(props.term.slug)
const parent = ref(props.term.parentId ?? NO_PARENT)
const description = ref(props.term.description)
const saving = ref(false)
const failure = ref<string>()

const parentItems = computed(() => [
  { value: NO_PARENT, label: t('terms.noParent') },
  ...props.parents.map((entry) => ({ value: entry.id, label: `${'   '.repeat(entry.depth)}${entry.name}` })),
])
const title = computed(() => (props.quick ? t('content.quickEdit.title') : termWords(t, props.taxonomy).edit))

async function submit() {
  if (saving.value) return
  const request: UpdateTermRequest = {}
  if (name.value.trim() !== props.term.name) request.name = name.value.trim()
  if (slug.value.trim() !== props.term.slug) request.slug = slug.value.trim()
  if (!props.quick) {
    const parentId = parent.value === NO_PARENT ? null : parent.value
    if (props.taxonomy === 'category' && parentId !== props.term.parentId) request.parentId = parentId
    if (description.value !== props.term.description) request.description = description.value
  }
  if (Object.keys(request).length === 0) {
    emit('close', false)
    return
  }
  saving.value = true
  failure.value = undefined
  try {
    failure.value = await props.save(request)
    if (failure.value === undefined) emit('close', true)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal :title="title" :ui="{ footer: 'justify-end' }">
    <template #body>
      <form id="term-edit" class="flex flex-col gap-4" @submit.prevent="submit">
        <UFormField :label="$t('terms.name')" name="name" :help="quick ? undefined : $t('terms.help.name')">
          <UInput v-model="name" size="xl" class="w-full" autocomplete="off" :maxlength="TERM_NAME_MAX_LENGTH" />
        </UFormField>
        <UFormField :label="$t('terms.slug')" name="slug" :help="quick ? undefined : $t('terms.help.slug')">
          <UInput v-model="slug" size="xl" class="w-full" autocomplete="off" />
        </UFormField>
        <template v-if="!quick">
          <UFormField v-if="taxonomy === 'category'" :label="$t('terms.parent')" name="parent">
            <USelect v-model="parent" :items="parentItems" size="xl" class="w-full" />
          </UFormField>
          <UFormField :label="$t('terms.description')" name="description">
            <UTextarea v-model="description" :rows="4" class="w-full" />
          </UFormField>
        </template>
        <UAlert
          v-if="failure"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('content.quickEdit.failed')"
          :description="failure"
        />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', false)">
        {{ $t('content.quickEdit.cancel') }}
      </UButton>
      <UButton type="submit" form="term-edit" size="lg" class="min-h-11" :loading="saving">
        {{ $t('content.quickEdit.update') }}
      </UButton>
    </template>
  </UModal>
</template>
