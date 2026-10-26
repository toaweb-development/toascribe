<script setup lang="ts">
import { splitTagNames } from '@toascribe/shared'
import type {
  ContentAuthorRef,
  ContentBulkChanges,
  ContentTypeKey,
  SettableContentStatus,
  TermItem,
} from '@toascribe/shared'

// «Rediger» among the bulk actions (K-035; WordPress' bulk edit): what is chosen is set on every ticked item, «— Ingen endring —»
// leaves a field alone. Posts: author, comments, status and «Fest øverst»; pages: author, parent, template, comments and status.
// Opened by the list (useOverlay); `save` answers with an error text or nothing, and the dialog closes when it worked.
const props = defineProps<{
  type: ContentTypeKey
  count: number
  /** Who can be an author; empty when the account may not choose. */
  authors: readonly ContentAuthorRef[]
  parents: readonly { id: string; label: string }[]
  mayPublish: boolean
  mayStick: boolean
  /** Posts: every category, in tree order. */
  categories: readonly TermItem[]
  save: (changes: ContentBulkChanges) => Promise<string | undefined>
}>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const { t } = useI18n()

const KEEP = 'keep'
const NO_PARENT = 'none'
const DEFAULT_TEMPLATE = 'default'

const author = ref(KEEP)
const comments = ref(KEEP)
const status = ref(KEEP)
const sticky = ref(KEEP)
const parent = ref(KEEP)
const template = ref(KEEP)
const addCategories = ref<string[]>([])
const addTagsText = ref('')

const keep = computed(() => ({ value: KEEP, label: t('content.bulkEdit.keep') }))
const authorItems = computed(() => [
  keep.value,
  ...props.authors.map((entry) => ({ value: entry.id, label: entry.displayName })),
])
const commentItems = computed(() => [
  keep.value,
  { value: 'open', label: t('content.bulkEdit.commentsOpen') },
  { value: 'closed', label: t('content.bulkEdit.commentsClosed') },
])
const statusItems = computed(() => [
  keep.value,
  ...(props.mayPublish ? (['publish', 'private'] as const) : []).map((value) => ({
    value,
    label: statusLabel(t, value),
  })),
  ...(['pending', 'draft'] as const).map((value) => ({ value, label: statusLabel(t, value) })),
])
const stickyItems = computed(() => [
  keep.value,
  { value: 'sticky', label: t('content.bulkEdit.sticky') },
  { value: 'notSticky', label: t('content.bulkEdit.notSticky') },
])
const parentItems = computed(() => [
  keep.value,
  { value: NO_PARENT, label: t('content.quickEdit.noParent') },
  ...props.parents.map((entry) => ({ value: entry.id, label: entry.label })),
])
const templateItems = computed(() => [
  keep.value,
  { value: DEFAULT_TEMPLATE, label: t('content.quickEdit.defaultTemplate') },
])

const saving = ref(false)
const failure = ref<string>()

function changes(): ContentBulkChanges | undefined {
  const chosen: Partial<ContentBulkChanges> = {}
  if (author.value !== KEEP) chosen.authorId = author.value
  if (comments.value === 'open' || comments.value === 'closed') chosen.commentStatus = comments.value
  if (status.value !== KEEP) chosen.status = status.value as SettableContentStatus
  if (sticky.value !== KEEP) chosen.sticky = sticky.value === 'sticky'
  if (parent.value !== KEEP) chosen.parentId = parent.value === NO_PARENT ? null : parent.value
  if (template.value !== KEEP) chosen.template = null
  if (addCategories.value.length > 0) chosen.addCategories = [...addCategories.value]
  const tags = splitTagNames(addTagsText.value)
  if (tags.length > 0) chosen.addTags = tags
  return Object.keys(chosen).length === 0 ? undefined : (chosen as ContentBulkChanges)
}

async function submit() {
  if (saving.value) return
  const chosen = changes()
  if (chosen === undefined) {
    emit('close', false)
    return
  }
  saving.value = true
  failure.value = undefined
  try {
    failure.value = await props.save(chosen)
    if (failure.value === undefined) emit('close', true)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :title="$t('content.bulkEdit.title')"
    :description="$t('content.bulkEdit.description', { n: count }, count)"
    :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
  >
    <template #body>
      <form id="bulk-edit" class="grid grid-cols-1 gap-4 sm:grid-cols-2" @submit.prevent="submit">
        <UFormField v-if="authors.length > 0" :label="$t('content.quickEdit.author')" name="author">
          <USelect v-model="author" :items="authorItems" size="xl" class="w-full" />
        </UFormField>
        <UFormField :label="$t('content.bulkEdit.comments')" name="comments">
          <USelect v-model="comments" :items="commentItems" size="xl" class="w-full" />
        </UFormField>
        <UFormField :label="$t('content.quickEdit.status')" name="status">
          <USelect v-model="status" :items="statusItems" size="xl" class="w-full" />
        </UFormField>
        <template v-if="type === 'post'">
          <ContentCategoryTree
            v-model="addCategories"
            :terms="categories"
            :legend="$t('content.bulkEdit.addCategories')"
          />
          <UFormField :label="$t('content.bulkEdit.addTags')" name="tags" :help="$t('terms.tags.separate')">
            <UTextarea v-model="addTagsText" :rows="3" autoresize class="w-full" />
          </UFormField>
        </template>
        <UFormField v-if="type === 'post' && mayStick" :label="$t('content.bulkEdit.stickyField')" name="sticky">
          <USelect v-model="sticky" :items="stickyItems" size="xl" class="w-full" />
        </UFormField>
        <template v-if="type === 'page'">
          <UFormField :label="$t('content.quickEdit.parent')" name="parent">
            <USelect v-model="parent" :items="parentItems" size="xl" class="w-full" />
          </UFormField>
          <UFormField :label="$t('content.quickEdit.template')" name="template">
            <USelect v-model="template" :items="templateItems" size="xl" class="w-full" />
          </UFormField>
        </template>
        <UAlert
          v-if="failure"
          class="sm:col-span-2"
          color="error"
          variant="subtle"
          role="alert"
          icon="i-lucide-triangle-alert"
          :title="$t('content.bulkEdit.failed')"
          :description="failure"
        />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="emit('close', false)">
        {{ $t('content.quickEdit.cancel') }}
      </UButton>
      <UButton type="submit" form="bulk-edit" size="lg" class="min-h-11" :loading="saving">
        {{ $t('content.quickEdit.update') }}
      </UButton>
    </template>
  </UModal>
</template>
