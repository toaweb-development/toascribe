<script setup lang="ts">
import { splitTagNames } from '@toascribe/shared'
import type {
  ContentAuthorRef,
  ContentListItem,
  SettableContentStatus,
  TermItem,
  UpdateContentRequest,
} from '@toascribe/shared'

// «Hurtigredigering» (K-036; WordPress' inline edit): title, slug, date, password or private, author, status and «Fest øverst», and
// for pages the parent, the order and the template. Opened by the list (useOverlay); it saves through `save`, which answers with an
// error text or nothing, and closes when the save worked. Only what was changed is sent. What the account may not change is not offered:
// the author needs `editOthers`, sticky needs `editOthers` and `publish`, the publishing statuses need `publish`.
const props = defineProps<{
  item: ContentListItem
  /** Who can be an author; empty when the account may not choose. */
  authors: readonly ContentAuthorRef[]
  /** The pages a page can be put under (the list's page tree, without the page itself and its children). */
  parents: readonly { id: string; label: string }[]
  /** Posts: every category, in tree order (empty for a page). */
  categories: readonly TermItem[]
  save: (request: UpdateContentRequest) => Promise<string | undefined>
}>()

const emit = defineEmits<{ close: [saved: boolean] }>()

const { t } = useI18n()

const NO_PARENT = 'none'
const DEFAULT_TEMPLATE = 'default'

/** `datetime-local` wants the local time without a zone. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const isPage = props.item.type === 'page'
const can = props.item.can
const startStatus: SettableContentStatus = props.item.status === 'trash' ? 'draft' : props.item.status

const title = ref(props.item.title)
const slug = ref(props.item.slug)
const date = ref(toLocalInput(props.item.publishedAt))
const password = ref('')
const removePassword = ref(false)
const isPrivate = ref(props.item.status === 'private')
const author = ref(props.item.authors[0]?.id ?? '')
const status = ref<SettableContentStatus>(startStatus === 'private' ? 'publish' : startStatus)
const sticky = ref(props.item.sticky)
const parent = ref(props.item.parentId ?? NO_PARENT)
const menuOrder = ref(String(props.item.menuOrder))
const template = ref(props.item.template ?? DEFAULT_TEMPLATE)
const chosenCategories = ref<string[]>(props.item.categories.map((term) => term.id))
const tagsText = ref(props.item.tags.map((term) => term.name).join(', '))

const statusItems = computed(() => {
  const own: SettableContentStatus[] = can.publish
    ? props.item.status === 'future'
      ? ['future', 'publish', 'pending', 'draft']
      : ['publish', 'pending', 'draft']
    : ['pending', 'draft']
  // A status the account may not set is still shown when the item has it, so the select tells the truth.
  if (!own.includes(status.value)) own.unshift(status.value)
  return own.map((value) => ({ value, label: statusLabel(t, value) }))
})
const authorItems = computed(() => props.authors.map((entry) => ({ value: entry.id, label: entry.displayName })))
const parentItems = computed(() => [
  { value: NO_PARENT, label: t('content.quickEdit.noParent') },
  ...props.parents.map((entry) => ({ value: entry.id, label: entry.label })),
])
const templateItems = computed(() => [
  { value: DEFAULT_TEMPLATE, label: t('content.quickEdit.defaultTemplate') },
  ...(props.item.template === null ? [] : [{ value: props.item.template, label: props.item.template }]),
])

const saving = ref(false)
const failure = ref<string>()

function request(): UpdateContentRequest {
  const changes: UpdateContentRequest = {}
  if (title.value !== props.item.title) changes.title = title.value
  if (slug.value.trim() !== props.item.slug) changes.slug = slug.value.trim()
  if (date.value !== toLocalInput(props.item.publishedAt)) {
    changes.publishedAt = date.value === '' ? null : new Date(date.value).toISOString()
  }
  const nextStatus: SettableContentStatus = isPrivate.value ? 'private' : status.value
  if (nextStatus !== startStatus) changes.status = nextStatus
  if (!isPrivate.value && password.value !== '') changes.password = password.value
  if (!isPrivate.value && password.value === '' && removePassword.value) changes.password = null
  if (can.editOthers && author.value !== '' && author.value !== props.item.authors[0]?.id)
    changes.authors = [author.value]
  if (sticky.value !== props.item.sticky) changes.sticky = sticky.value
  if (!isPage) {
    const before = props.item.categories.map((term) => term.id)
    if (chosenCategories.value.length !== before.length || chosenCategories.value.some((id) => !before.includes(id))) {
      changes.categories = [...chosenCategories.value]
    }
    const tags = splitTagNames(tagsText.value)
    const beforeTags = props.item.tags.map((term) => term.name)
    if (tags.join('\u0000') !== beforeTags.join('\u0000')) changes.tags = tags
  }
  if (isPage) {
    const parentId = parent.value === NO_PARENT ? null : parent.value
    if (parentId !== props.item.parentId) changes.parentId = parentId
    const order = Number.parseInt(menuOrder.value, 10)
    if (!Number.isNaN(order) && order !== props.item.menuOrder) changes.menuOrder = order
    const chosen = template.value === DEFAULT_TEMPLATE ? null : template.value
    if (chosen !== props.item.template) changes.template = chosen
  }
  return changes
}

async function submit() {
  if (saving.value) return
  const changes = request()
  if (Object.keys(changes).length === 0) {
    emit('close', false)
    return
  }
  saving.value = true
  failure.value = undefined
  try {
    failure.value = await props.save(changes)
    if (failure.value === undefined) emit('close', true)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal :title="$t('content.quickEdit.title')" :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }">
    <template #body>
      <form id="quick-edit" class="grid grid-cols-1 gap-4 sm:grid-cols-2" @submit.prevent="submit">
        <UFormField :label="$t('content.quickEdit.titleField')" name="title" class="sm:col-span-2">
          <UInput v-model="title" size="xl" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField :label="$t('content.quickEdit.slug')" name="slug">
          <UInput v-model="slug" size="xl" class="w-full" autocomplete="off" />
        </UFormField>
        <UFormField :label="$t('content.quickEdit.date')" name="date" :help="$t('content.quickEdit.dateHelp')">
          <UInput v-model="date" type="datetime-local" size="xl" class="w-full" />
        </UFormField>
        <UFormField
          :label="$t('content.quickEdit.password')"
          name="password"
          :help="item.visibility === 'password' ? $t('content.quickEdit.passwordSet') : undefined"
        >
          <UInput
            v-model="password"
            type="password"
            size="xl"
            class="w-full"
            autocomplete="new-password"
            :disabled="isPrivate"
          />
        </UFormField>
        <div class="flex flex-col justify-end gap-2">
          <p class="text-sm text-toned">{{ $t('content.quickEdit.or') }}</p>
          <UCheckbox v-if="can.publish" v-model="isPrivate" size="lg" :label="$t('content.quickEdit.private')" />
          <UCheckbox
            v-if="item.visibility === 'password' && !isPrivate"
            v-model="removePassword"
            size="lg"
            :label="$t('content.quickEdit.removePassword')"
          />
        </div>
        <UFormField
          v-if="can.editOthers && authorItems.length > 0"
          :label="$t('content.quickEdit.author')"
          name="author"
        >
          <USelect v-model="author" :items="authorItems" size="xl" class="w-full" />
        </UFormField>
        <UFormField :label="$t('content.quickEdit.status')" name="status">
          <USelect v-model="status" :items="statusItems" size="xl" class="w-full" :disabled="isPrivate" />
        </UFormField>
        <template v-if="isPage">
          <UFormField :label="$t('content.quickEdit.parent')" name="parent">
            <USelect v-model="parent" :items="parentItems" size="xl" class="w-full" />
          </UFormField>
          <UFormField :label="$t('content.quickEdit.order')" name="menuOrder">
            <UInput v-model="menuOrder" type="number" inputmode="numeric" size="xl" class="w-full" />
          </UFormField>
          <UFormField :label="$t('content.quickEdit.template')" name="template">
            <USelect v-model="template" :items="templateItems" size="xl" class="w-full" />
          </UFormField>
        </template>
        <template v-else>
          <ContentCategoryTree v-model="chosenCategories" :terms="categories" :legend="$t('terms.categories.title')" />
          <UFormField :label="$t('terms.tags.title')" name="tags" :help="$t('terms.tags.separate')">
            <UTextarea v-model="tagsText" :rows="3" autoresize class="w-full" />
          </UFormField>
          <UCheckbox
            v-if="can.editOthers && can.publish"
            v-model="sticky"
            size="lg"
            class="sm:col-span-2"
            :label="$t('content.quickEdit.sticky')"
          />
        </template>
        <UAlert
          v-if="failure"
          class="sm:col-span-2"
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
      <UButton type="submit" form="quick-edit" size="lg" class="min-h-11" :loading="saving">
        {{ $t('content.quickEdit.update') }}
      </UButton>
    </template>
  </UModal>
</template>
