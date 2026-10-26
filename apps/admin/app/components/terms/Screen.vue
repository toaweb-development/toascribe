<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import { TERM_NAME_MAX_LENGTH } from '@toascribe/shared'
import type { BuiltInTaxonomy, TermItem, TermListResponse, UpdateTermRequest } from '@toascribe/shared'
import { TermsEdit } from '#components'

// «Kategorier» and «Stikkord» (M1.2; WordPress' edit-tags.php): the form to add a term on the left, the list on the right (below it on a
// phone), with search, bulk delete, row actions (Rediger, Hurtigrediger, Slett) and the count of published posts, which links to the post
// list filtered by the term. The default category («Ukategorisert») has no delete action and no checkbox, as in WordPress. Changes need
// `manage_categories`; the menu shows the screens only to those who hold it.
const props = defineProps<{ taxonomy: BuiltInTaxonomy }>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuth()
const termsApi = useTermsApi()
const confirm = useConfirmDialog()
const overlay = useOverlay()

const isCategory = props.taxonomy === 'category'
const words = computed(() => termWords(t, props.taxonomy))
const mayManage = computed(
  () =>
    auth.session.value.status === 'authenticated' &&
    auth.session.value.account.capabilities.includes('manage_categories'),
)
if (import.meta.server && !mayManage.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const search = computed(() =>
  typeof route.query.search === 'string' ? route.query.search.trim().slice(0, TERM_NAME_MAX_LENGTH) : '',
)
const page = computed(() => {
  const value = typeof route.query.page === 'string' ? Number(route.query.page) : 1
  return Number.isInteger(value) && value >= 1 && value <= 1_000_000 ? value : 1
})

const { data, status, error, refresh } = await useAsyncData(
  `terms:${props.taxonomy}`,
  async (): Promise<TermListResponse | null> =>
    mayManage.value
      ? await termsApi.list(props.taxonomy, {
          ...(search.value === '' ? {} : { search: search.value }),
          page: page.value,
          per_page: 20,
        })
      : null,
  { watch: [search, page] },
)
const { data: parentTerms, refresh: refreshParents } = await useAsyncData(
  `terms:${props.taxonomy}:parents`,
  async (): Promise<TermItem[]> => (isCategory && mayManage.value ? await termsApi.all('category') : []),
)

const items = computed(() => data.value?.items ?? [])
const searchText = ref(search.value)
watch(search, (next) => {
  searchText.value = next
})

function locationFor(query: { search?: string; page?: number }): RouteLocationRaw {
  const next: Record<string, string> = {}
  const text = query.search ?? search.value
  if (text !== '') next.search = text
  const number = query.page ?? 1
  if (number !== 1) next.page = String(number)
  return { path: route.path, query: next }
}

const report = ref<string>()
const failure = ref<string>()

function errorText(caught: unknown): string {
  return termErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

async function reload() {
  await Promise.all([refresh(), refreshParents()])
}

// --- Add -----------------------------------------------------------------------------------------------------------------------------
const NO_PARENT = 'none'
const form = reactive({ name: '', slug: '', parent: NO_PARENT, about: '' })
const adding = ref(false)
const addError = ref<string>()
const parentItems = computed(() => [
  { value: NO_PARENT, label: t('terms.noParent') },
  ...(parentTerms.value ?? []).map((term) => ({
    value: term.id,
    label: `${'   '.repeat(term.depth)}${term.name}`,
  })),
])

async function add() {
  if (adding.value) return
  if (form.name.trim() === '') {
    addError.value = t('terms.nameRequired')
    return
  }
  adding.value = true
  addError.value = undefined
  try {
    await termsApi.create(props.taxonomy, {
      name: form.name.trim(),
      ...(form.slug.trim() === '' ? {} : { slug: form.slug.trim() }),
      ...(isCategory && form.parent !== NO_PARENT ? { parentId: form.parent } : {}),
      ...(form.about === '' ? {} : { description: form.about }),
    })
    report.value = words.value.added
    Object.assign(form, { name: '', slug: '', parent: NO_PARENT, about: '' })
    await reload()
  } catch (caught) {
    addError.value = errorText(caught)
  } finally {
    adding.value = false
  }
}

// --- Edit, quick edit, delete -------------------------------------------------------------------------------------------------------
const editDialog = overlay.create(TermsEdit)

async function openEdit(term: TermItem, quick: boolean) {
  report.value = undefined
  const below = new Set([term.id])
  for (const entry of parentTerms.value ?? []) {
    if (entry.parentId !== null && below.has(entry.parentId)) below.add(entry.id)
  }
  const saved = await editDialog.open({
    term,
    taxonomy: props.taxonomy,
    quick,
    parents: (parentTerms.value ?? []).filter((entry) => !below.has(entry.id)),
    save: async (request: UpdateTermRequest) => {
      try {
        await termsApi.update(props.taxonomy, term.id, request)
        return undefined
      } catch (caught) {
        return errorText(caught)
      }
    },
  })
  if (saved === true) {
    report.value = words.value.updated
    await reload()
  }
}

async function removeOne(term: TermItem) {
  const confirmed = await confirm.ask({
    title: words.value.confirmTitle,
    description: isCategory
      ? t('terms.confirm.category', { name: term.name })
      : t('terms.confirm.tag', { name: term.name }),
    confirmLabel: t('terms.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!confirmed) return
  failure.value = undefined
  try {
    await termsApi.remove(props.taxonomy, term.id)
    report.value = words.value.deleted
    await reload()
  } catch (caught) {
    failure.value = errorText(caught)
  }
}

// --- Bulk delete ----------------------------------------------------------------------------------------------------------------------
const selected = ref<string[]>([])
watch(items, (rows) => {
  selected.value = selected.value.filter((id) => rows.some((row) => row.id === id))
})
const bulkAction = ref<string | undefined>()
const bulkItems = computed(() => [{ value: 'delete', label: t('terms.delete') }])
const busy = ref(false)

async function applyBulk() {
  if (bulkAction.value !== 'delete' || selected.value.length === 0 || busy.value) return
  const ids = [...selected.value]
  const confirmed = await confirm.ask({
    title: words.value.confirmTitle,
    description: t('terms.confirm.many', { n: ids.length }, ids.length),
    confirmLabel: t('terms.delete'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (!confirmed) return
  busy.value = true
  failure.value = undefined
  try {
    const result = await termsApi.bulk(props.taxonomy, { action: 'delete', ids })
    report.value = t('terms.bulkDeleted', { n: result.changed.length }, result.changed.length)
    selected.value = []
    bulkAction.value = undefined
    await reload()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    busy.value = false
  }
}

function toggle(id: string, on: boolean | 'indeterminate') {
  selected.value = on === true ? [...new Set([...selected.value, id])] : selected.value.filter((entry) => entry !== id)
}
const deletable = computed(() => items.value.filter((term) => !term.isDefault))
const allState = computed<boolean | 'indeterminate'>(() =>
  deletable.value.length > 0 && deletable.value.every((term) => selected.value.includes(term.id))
    ? true
    : selected.value.length > 0
      ? 'indeterminate'
      : false,
)
function toggleAll(on: boolean) {
  selected.value = on ? deletable.value.map((term) => term.id) : []
}

const postsLink = (term: TermItem) => ({
  path: '/posts',
  query: isCategory ? { category: term.id } : { tag: term.id },
})
const label = (term: TermItem) => `${'— '.repeat(term.depth)}${term.name}`
const checkboxHitClass = 'flex size-11 shrink-0 cursor-pointer items-center justify-center lg:size-8'
const actionClass =
  'inline-flex min-h-11 items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-6'
const dangerClass =
  'inline-flex min-h-11 items-center rounded-sm text-sm text-error underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-6'
const PAGE_BUTTON = 'min-h-11 min-w-11 lg:min-h-8 lg:min-w-8'
</script>

<template>
  <UDashboardPanel :id="`terms-${taxonomy}`">
    <template #header>
      <UDashboardNavbar :title="words.title" />
    </template>

    <template #body>
      <section v-if="!mayManage" aria-labelledby="terms-denied-heading" class="flex max-w-prose flex-col gap-3">
        <h2 id="terms-denied-heading" class="text-xl font-semibold text-highlighted">{{ words.denied }}</h2>
        <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
      </section>

      <div v-else class="grid w-full grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section aria-labelledby="terms-add-heading" class="flex flex-col gap-4">
          <h2 id="terms-add-heading" class="text-lg font-semibold text-highlighted">{{ words.add }}</h2>
          <form class="flex flex-col gap-4" @submit.prevent="add">
            <UFormField :label="$t('terms.name')" name="name" :help="$t('terms.help.name')" :error="addError">
              <UInput
                v-model="form.name"
                size="xl"
                class="w-full"
                autocomplete="off"
                :maxlength="TERM_NAME_MAX_LENGTH"
              />
            </UFormField>
            <UFormField :label="$t('terms.slug')" name="slug" :help="$t('terms.help.slug')">
              <UInput v-model="form.slug" size="xl" class="w-full" autocomplete="off" />
            </UFormField>
            <UFormField v-if="isCategory" :label="$t('terms.parent')" name="parent" :help="$t('terms.help.parent')">
              <USelect v-model="form.parent" :items="parentItems" size="xl" class="w-full" />
            </UFormField>
            <UFormField :label="$t('terms.description')" name="description" :help="$t('terms.help.description')">
              <UTextarea v-model="form.about" :rows="4" class="w-full" />
            </UFormField>
            <div>
              <UButton type="submit" size="lg" class="min-h-11" :loading="adding">{{ words.add }}</UButton>
            </div>
          </form>
        </section>

        <section aria-labelledby="terms-list-heading" class="flex min-w-0 flex-col gap-4">
          <h2 id="terms-list-heading" class="sr-only">{{ words.caption }}</h2>
          <div class="flex flex-wrap items-end justify-between gap-4">
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="applyBulk">
              <UFormField :label="$t('content.bulk.label')" name="action">
                <USelect
                  v-model="bulkAction"
                  :items="bulkItems"
                  :placeholder="$t('content.bulk.choose')"
                  size="xl"
                  class="w-full sm:w-48"
                />
              </UFormField>
              <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11" :loading="busy">
                {{ $t('content.bulk.apply') }}
              </UButton>
            </form>
            <form
              role="search"
              class="flex flex-wrap items-end gap-2"
              @submit.prevent="router.push(locationFor({ search: searchText.trim() }))"
            >
              <div class="flex min-w-0 flex-col gap-1.5">
                <label :for="`terms-search-${taxonomy}`" class="font-medium text-default">{{ words.search }}</label>
                <UInput
                  :id="`terms-search-${taxonomy}`"
                  v-model="searchText"
                  type="search"
                  size="xl"
                  autocomplete="off"
                  icon="i-lucide-search"
                />
              </div>
              <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11">
                {{ words.search }}
              </UButton>
            </form>
          </div>

          <div role="status">
            <UAlert v-if="report" color="success" variant="subtle" icon="i-lucide-circle-check" :title="report" />
          </div>
          <UAlert
            v-if="failure || error"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('content.actionFailed')"
            :description="failure"
          />

          <p v-if="data" role="status" class="text-sm text-toned">
            {{ $t('content.count', { n: data.total }, data.total) }}
          </p>
          <p v-if="data && items.length === 0" class="py-6 text-lg font-semibold text-highlighted">{{ words.empty }}</p>

          <div v-else-if="data" :class="status === 'pending' ? 'opacity-60' : ''">
            <label class="flex min-h-11 cursor-pointer items-center gap-3 text-base text-default">
              <span :class="checkboxHitClass">
                <UCheckbox size="lg" :model-value="allState" @update:model-value="toggleAll($event === true)" />
              </span>
              {{ $t('content.table.selectAll') }}
            </label>
            <ul
              class="flex flex-col divide-y divide-default rounded-md border border-default"
              :aria-label="words.caption"
            >
              <li v-for="term in items" :key="term.id" class="flex items-start gap-1 p-2">
                <label v-if="!term.isDefault" :class="checkboxHitClass">
                  <UCheckbox
                    size="lg"
                    :model-value="selected.includes(term.id)"
                    :aria-label="$t('content.table.select', { title: term.name })"
                    @update:model-value="toggle(term.id, $event)"
                  />
                </label>
                <span v-else :class="checkboxHitClass" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pe-1">
                  <p class="font-semibold text-highlighted wrap-anywhere">{{ label(term) }}</p>
                  <p v-if="term.description !== ''" class="text-sm text-default wrap-anywhere">
                    {{ term.description }}
                  </p>
                  <p class="text-sm text-toned wrap-anywhere">
                    {{ $t('terms.slug') }}: {{ term.slug }} ·
                    <NuxtLink :to="postsLink(term)" class="text-primary underline-offset-4 hover:underline">
                      {{ $t('terms.countLabel', { n: term.count }, term.count) }}
                    </NuxtLink>
                  </p>
                  <ul class="flex flex-wrap gap-x-3" :aria-label="$t('content.actions.label', { title: term.name })">
                    <li>
                      <button
                        type="button"
                        :class="actionClass"
                        :aria-label="$t('terms.editNamed', { name: term.name })"
                        @click="openEdit(term, false)"
                      >
                        {{ $t('content.actions.edit') }}
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        :class="actionClass"
                        :aria-label="$t('content.actions.quickEditNamed', { title: term.name })"
                        @click="openEdit(term, true)"
                      >
                        {{ $t('content.actions.quickEdit') }}
                      </button>
                    </li>
                    <li v-if="!term.isDefault">
                      <button
                        type="button"
                        :class="dangerClass"
                        :aria-label="$t('terms.deleteNamed', { name: term.name })"
                        @click="removeOne(term)"
                      >
                        {{ $t('terms.delete') }}
                      </button>
                    </li>
                  </ul>
                </div>
              </li>
            </ul>
          </div>

          <UPagination
            v-if="data && data.totalPages > 1"
            as="nav"
            :aria-label="$t('content.pagination')"
            :page="page"
            :total="data.total"
            :items-per-page="data.perPage"
            :sibling-count="1"
            show-edges
            :to="(number: number) => locationFor({ page: number })"
            :ui="{
              list: 'flex-wrap',
              item: PAGE_BUTTON,
              prev: PAGE_BUTTON,
              next: PAGE_BUTTON,
              first: PAGE_BUTTON,
              last: PAGE_BUTTON,
            }"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
