<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import { DEFAULT_LIST_SCREEN_OPTIONS } from '@toascribe/shared'
import type {
  ContentAuthorRef,
  ContentBulkChanges,
  ContentListItem,
  ContentListResponse,
  ContentTypeKey,
  ListScreenOptions,
  TermItem,
  UpdateContentRequest,
} from '@toascribe/shared'
import { ContentBulkEdit, ContentQuickEdit, ContentScreenOptions } from '#components'

import type { BulkAction } from '~/utils/content-text'
import type { ContentView } from '~/utils/content-query'

// «Alle innlegg» and «Alle sider» (K-034 to K-037; WordPress' edit.php): the views with their counts, the month filter, the search,
// the sort, the pages, the row actions, quick edit, the bulk actions and the screen options. The state of the list is in the address
// (utils/content-query.ts), as on the users list; every control is a link or a form that changes it.
const props = defineProps<{ type: ContentTypeKey }>()

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuth()
const contentApi = useContentApi()
const termsApi = useTermsApi()
const confirm = useConfirmDialog()
const overlay = useOverlay()
const { preferences, update: updatePreferences } = useAdminPreferences()

const words = computed(() => typeText(t, props.type))
const account = computed(() => (auth.session.value.status === 'authenticated' ? auth.session.value.account : undefined))
const capability = props.type === 'page' ? 'edit_pages' : 'edit_posts'
const mayEdit = computed(() => account.value?.capabilities.includes(capability) === true)

if (import.meta.server && !mayEdit.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 403)
}

const screen = computed<ListScreenOptions>(
  () =>
    (props.type === 'page' ? preferences.value?.pagesScreen : preferences.value?.postsScreen) ??
    DEFAULT_LIST_SCREEN_OPTIONS,
)
const view = computed(() => parseContentView(route.query))
const forbidden = ref(false)

const { data, status, error, refresh } = await useAsyncData(
  `content:list:${props.type}`,
  async (): Promise<ContentListResponse | null> => {
    forbidden.value = false
    if (!mayEdit.value) return null
    try {
      return await contentApi.list(toContentListQuery(view.value, props.type, account.value?.id, screen.value.perPage))
    } catch (caught) {
      forbidden.value = caught instanceof ApiRequestError && caught.status === 403
      throw caught
    }
  },
  { watch: [view, () => screen.value.perPage] },
)

const denied = computed(() => !mayEdit.value || forbidden.value)
const items = computed(() => data.value?.items ?? [])
const inTrash = computed(() => view.value.status === 'trash')
const filtered = computed(
  () =>
    view.value.search !== '' ||
    view.value.month !== '' ||
    view.value.category !== '' ||
    view.value.tag !== '' ||
    view.value.mine ||
    view.value.status !== 'all',
)

// The categories, in tree order: for the filter, quick edit and bulk edit. Posts only; read once with the page.
const { data: categoryTerms } = await useAsyncData(`content:categories:${props.type}`, async (): Promise<TermItem[]> =>
  props.type === 'post' && mayEdit.value ? await termsApi.all('category').catch(() => []) : [],
)
const categories = computed(() => categoryTerms.value ?? [])
const ALL_CATEGORIES = 'all'
const category = ref(view.value.category === '' ? ALL_CATEGORIES : view.value.category)
const categoryItems = computed(() => [
  { value: ALL_CATEGORIES, label: t('terms.categories.all') },
  ...categories.value.map((term) => ({
    value: term.id,
    label: `${'\u00a0\u00a0\u00a0'.repeat(term.depth)}${term.name}`,
  })),
])

function locationFor(changes: Partial<ContentView>): RouteLocationRaw {
  return { path: route.path, query: contentViewQuery(changeContentView(view.value, changes)) }
}

// --- Views, month and search -----------------------------------------------------------------------------------------------------
const VIEWS = ['all', 'mine', 'publish', 'draft', 'pending', 'future', 'private', 'trash'] as const
const viewLinks = computed(() => {
  const counts = data.value?.counts
  if (counts === undefined) return []
  return VIEWS.flatMap((key) => {
    const count = counts[key]
    // As WordPress: «Alle» always, the others only when they have items.
    if (key !== 'all' && count === 0) return []
    const current = key === 'mine' ? view.value.mine : !view.value.mine && view.value.status === key
    const changes: Partial<ContentView> = key === 'mine' ? { status: 'all', mine: true } : { status: key, mine: false }
    return [{ key, label: viewLabel(t, key), count, current, to: locationFor(changes) }]
  })
})

const ALL_MONTHS = 'all'
const month = ref(view.value.month === '' ? ALL_MONTHS : view.value.month)
const searchText = ref(view.value.search)
watch(view, (next) => {
  category.value = next.category === '' ? ALL_CATEGORIES : next.category
  month.value = next.month === '' ? ALL_MONTHS : next.month
  searchText.value = next.search
})
const monthItems = computed(() => [
  { value: ALL_MONTHS, label: t('content.filter.allMonths') },
  ...(data.value?.months ?? []).map((value) => ({ value, label: monthLabel(value, locale.value) })),
])

function applyFilter() {
  void router.push(
    locationFor({
      month: month.value === ALL_MONTHS ? '' : month.value,
      category: category.value === ALL_CATEGORIES ? '' : category.value,
      tag: '',
    }),
  )
}

function search() {
  void router.push(locationFor({ search: searchText.value.trim() }))
}

// --- Selection, messages ------------------------------------------------------------------------------------------------------------
const selected = ref<string[]>([])
const report = ref<{ tone: 'success' | 'warning' | 'info'; title: string; details: string[] }>()
const failure = ref<string>()
watch(view, () => {
  selected.value = []
  report.value = undefined
  failure.value = undefined
})
watch(items, (rows) => {
  selected.value = selected.value.filter((id) => rows.some((row) => row.id === id))
})

function errorText(caught: unknown): string {
  return contentErrorText(t, caught instanceof ApiRequestError ? caught.code : undefined) ?? describeApiError(caught, t)
}

function clampPage(list: ContentListResponse | null | undefined) {
  if (list && list.items.length === 0 && list.total > 0 && view.value.page > 1) {
    void router.replace(locationFor({ page: Math.max(1, list.totalPages) }))
  }
}
watch(data, clampPage)
onMounted(() => clampPage(data.value))

// --- Row actions ----------------------------------------------------------------------------------------------------------------------
async function act(work: () => Promise<unknown>, done: string) {
  report.value = undefined
  failure.value = undefined
  try {
    await work()
    report.value = { tone: 'success', title: done, details: [] }
    await refresh()
  } catch (caught) {
    failure.value = errorText(caught)
  }
}

function trashOne(item: ContentListItem) {
  void act(() => contentApi.trash(item.id), t('content.bulkDone.trashed', { n: 1 }, 1))
}

function restoreOne(item: ContentListItem) {
  void act(() => contentApi.restore(item.id), t('content.bulkDone.restored', { n: 1 }, 1))
}

async function removeOne(item: ContentListItem) {
  const confirmed = await confirm.ask({
    title: t('content.confirmDelete.title', { n: 1 }, 1),
    description: t('content.confirmDelete.text', { title: titleOf(t, item.title) }),
    confirmLabel: t('content.actions.remove'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (confirmed) void act(() => contentApi.remove(item.id), t('content.bulkDone.deleted', { n: 1 }, 1))
}

// --- Authors and parents for quick edit and bulk edit ------------------------------------------------------------------------------
const mayChooseAuthors = computed(() => items.value.some((item) => item.can.editOthers))
const authors = ref<ContentAuthorRef[]>([])
async function loadAuthors(): Promise<ContentAuthorRef[]> {
  if (!mayChooseAuthors.value) return []
  if (authors.value.length === 0) {
    try {
      authors.value = (await contentApi.authors(props.type)).authors
    } catch {
      authors.value = []
    }
  }
  return authors.value
}

/** The pages a page can be put under: the page tree (up to 100), without the page and the pages below it. */
async function loadParents(exclude: string | undefined): Promise<{ id: string; label: string }[]> {
  if (props.type !== 'page') return []
  const tree = await contentApi.list({ type: 'page', per_page: 100 })
  const below = new Set<string>(exclude === undefined ? [] : [exclude])
  for (const entry of tree.items) {
    if (entry.parentId !== null && below.has(entry.parentId)) below.add(entry.id)
  }
  return tree.items
    .filter((entry) => !below.has(entry.id))
    .map((entry) => ({ id: entry.id, label: `${depthPrefix(entry.depth)}${titleOf(t, entry.title)}` }))
}

const quickEditDialog = overlay.create(ContentQuickEdit)
async function quickEdit(item: ContentListItem) {
  const [authorList, parents] = await Promise.all([loadAuthors(), loadParents(item.id).catch(() => [])])
  const saved = await quickEditDialog.open({
    item,
    authors: authorList,
    parents,
    categories: categories.value,
    save: async (request: UpdateContentRequest) => {
      try {
        await contentApi.update(item.id, request)
        return undefined
      } catch (caught) {
        return errorText(caught)
      }
    },
  })
  if (saved === true) {
    report.value = { tone: 'success', title: t('content.quickEdit.saved'), details: [] }
    await refresh()
  }
}

// --- Bulk actions ---------------------------------------------------------------------------------------------------------------------
const bulkAction = ref<BulkAction | ''>('')
const busy = ref(false)
const bulkItems = computed(() =>
  inTrash.value
    ? [
        { value: 'restore', label: t('content.bulk.restore') },
        { value: 'delete', label: t('content.bulk.delete') },
      ]
    : [
        { value: 'edit', label: t('content.bulk.edit') },
        { value: 'trash', label: t('content.bulk.trash') },
      ],
)
const chosenAction = computed<string | undefined>({
  get: () => (bulkAction.value === '' ? undefined : bulkAction.value),
  set: (next) => {
    bulkAction.value = next === 'edit' || next === 'trash' || next === 'restore' || next === 'delete' ? next : ''
  },
})
const selectable = computed(() => items.value.some((item) => item.can.edit || item.can.delete))
const bulkHint = computed(() => {
  if (selected.value.length === 0) return t('content.bulk.needItems')
  return bulkAction.value === '' ? t('content.bulk.needAction') : ''
})

const bulkEditDialog = overlay.create(ContentBulkEdit)

async function runBulk(action: BulkAction | 'empty_trash', ids: string[], changes?: ContentBulkChanges) {
  busy.value = true
  report.value = undefined
  failure.value = undefined
  try {
    const response =
      action === 'empty_trash'
        ? await contentApi.bulk({ action, type: props.type })
        : action === 'edit'
          ? changes === undefined
            ? undefined
            : await contentApi.bulk({ action, ids, changes })
          : await contentApi.bulk({ action, ids })
    if (response === undefined) return
    report.value = describeBulk(t, action, response)
    selected.value = selected.value.filter((id) => !response.changed.includes(id) && !response.unchanged.includes(id))
    bulkAction.value = ''
    await refresh()
  } catch (caught) {
    failure.value = errorText(caught)
  } finally {
    busy.value = false
  }
}

async function applyBulk() {
  const action = bulkAction.value
  const ids = [...selected.value]
  if (action === '' || ids.length === 0 || busy.value) return
  if (action === 'edit') {
    const authorList = await loadAuthors()
    const parents = await loadParents(undefined).catch(() => [])
    const mayPublish = items.value.some((item) => item.can.publish)
    await bulkEditDialog.open({
      type: props.type,
      count: ids.length,
      authors: authorList,
      parents,
      mayPublish,
      mayStick: mayPublish && mayChooseAuthors.value,
      categories: categories.value,
      save: async (changes: ContentBulkChanges) => {
        await runBulk('edit', ids, changes)
        return failure.value
      },
    })
    return
  }
  if (action === 'delete') {
    const confirmed = await confirm.ask({
      title: t('content.confirmDelete.title', { n: ids.length }, ids.length),
      description: t('content.confirmDelete.many', { n: ids.length }, ids.length),
      confirmLabel: t('content.actions.remove'),
      cancelLabel: t('content.quickEdit.cancel'),
      color: 'error',
    })
    if (!confirmed) return
  }
  await runBulk(action, ids)
}

async function emptyTrash() {
  const confirmed = await confirm.ask({
    title: t('content.confirmEmpty.title'),
    description: t('content.confirmEmpty.text'),
    confirmLabel: t('content.bulk.emptyTrash'),
    cancelLabel: t('content.quickEdit.cancel'),
    color: 'error',
  })
  if (confirmed) await runBulk('empty_trash', [])
}

// --- Screen options ----------------------------------------------------------------------------------------------------------------
const screenDialog = overlay.create(ContentScreenOptions)
async function openScreenOptions() {
  await screenDialog.open({
    options: screen.value,
    type: props.type,
    save: async (options: ListScreenOptions) => {
      try {
        await updatePreferences(props.type === 'page' ? { pagesScreen: options } : { postsScreen: options })
        return undefined
      } catch (caught) {
        return describeApiError(caught, t)
      }
    },
  })
}

const results = useTemplateRef<HTMLElement>('results')
watch(status, async (now, before) => {
  if (import.meta.client && before === 'pending' && now === 'success') {
    await nextTick()
    const active = document.activeElement
    if (!active || active === document.body) results.value?.focus({ preventScroll: true })
  }
})

const PAGE_BUTTON = 'min-h-11 min-w-11 lg:min-h-8 lg:min-w-8'
const newPath = computed(() => `/${props.type === 'page' ? 'pages' : 'posts'}/new`)
</script>

<template>
  <UDashboardPanel :id="`content-${type}`">
    <template #header>
      <UDashboardNavbar :title="words.title">
        <template #right>
          <UButton
            v-if="mayEdit"
            color="neutral"
            variant="outline"
            size="lg"
            class="min-h-11"
            icon="i-lucide-columns-3"
            @click="openScreenOptions"
          >
            {{ $t('content.screenOptions.open') }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex w-full flex-col gap-4 sm:gap-5">
        <section v-if="denied" aria-labelledby="content-denied-heading" class="flex max-w-prose flex-col gap-3">
          <h2 id="content-denied-heading" class="text-xl font-semibold text-highlighted">{{ words.denied }}</h2>
          <p class="text-base text-default">{{ $t('content.denied.text') }}</p>
          <div>
            <NuxtLink
              to="/"
              class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
            >
              {{ $t('content.denied.back') }}
            </NuxtLink>
          </div>
        </section>

        <template v-else>
          <div>
            <UButton :to="newPath" size="lg" class="min-h-11" icon="i-lucide-plus">{{ words.add }}</UButton>
          </div>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('content.failed.title')"
          >
            <template #description>
              <p>{{ data ? $t('content.failed.stale') : $t('content.failed.text') }}</p>
            </template>
            <template #actions>
              <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
                {{ $t('content.failed.retry') }}
              </UButton>
            </template>
          </UAlert>

          <nav v-if="data" :aria-label="words.views">
            <ul class="flex flex-wrap gap-x-1">
              <li v-for="link in viewLinks" :key="link.key">
                <NuxtLink
                  :to="link.to"
                  :aria-current="link.current ? 'page' : undefined"
                  class="inline-flex min-h-11 items-center rounded-md px-2.5 text-base underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8"
                  :class="link.current ? 'font-semibold text-highlighted underline' : 'text-primary'"
                >
                  {{ $t('content.views.item', { name: link.label, n: link.count }) }}
                </NuxtLink>
              </li>
            </ul>
          </nav>

          <div v-if="data" class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
              <form v-if="selectable" class="flex flex-wrap items-end gap-2" @submit.prevent="applyBulk">
                <UFormField :label="$t('content.bulk.label')" name="action">
                  <USelect
                    id="content-bulk-action"
                    v-model="chosenAction"
                    :items="bulkItems"
                    :placeholder="$t('content.bulk.choose')"
                    size="xl"
                    class="w-full sm:w-56"
                  />
                </UFormField>
                <UButton
                  type="submit"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  class="min-h-11"
                  :loading="busy"
                  :aria-disabled="bulkHint !== ''"
                  :aria-describedby="bulkHint === '' ? undefined : 'content-bulk-hint'"
                >
                  {{ $t('content.bulk.apply') }}
                </UButton>
                <p v-if="bulkHint !== ''" id="content-bulk-hint" class="basis-full text-sm text-toned">
                  {{ bulkHint }}
                </p>
              </form>

              <form class="flex flex-wrap items-end gap-2" @submit.prevent="applyFilter">
                <UFormField :label="$t('content.filter.month')" name="month">
                  <USelect id="content-month" v-model="month" :items="monthItems" size="xl" class="w-full sm:w-48" />
                </UFormField>
                <UFormField v-if="type === 'post'" :label="$t('content.filter.category')" name="category">
                  <USelect
                    id="content-category"
                    v-model="category"
                    :items="categoryItems"
                    size="xl"
                    class="w-full sm:w-56"
                  />
                </UFormField>
                <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11">
                  {{ $t('content.filter.apply') }}
                </UButton>
              </form>

              <UButton
                v-if="inTrash && data.counts.trash > 0"
                color="error"
                variant="outline"
                size="lg"
                class="min-h-11"
                :loading="busy"
                @click="emptyTrash"
              >
                {{ $t('content.bulk.emptyTrash') }}
              </UButton>
            </div>

            <form role="search" class="flex flex-wrap items-end gap-2" @submit.prevent="search">
              <div class="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
                <label for="content-search" class="font-medium text-default">{{ words.search }}</label>
                <UInput
                  id="content-search"
                  v-model="searchText"
                  type="search"
                  name="search"
                  size="xl"
                  fixed
                  class="w-full"
                  autocomplete="off"
                  icon="i-lucide-search"
                />
              </div>
              <UButton type="submit" color="neutral" variant="outline" size="lg" class="min-h-11">
                {{ words.search }}
              </UButton>
            </form>
          </div>

          <p v-if="selectable && selected.length > 0" role="status" class="text-sm text-default">
            {{ $t('content.bulk.selected', { n: selected.length }, selected.length) }}
          </p>

          <div role="status">
            <UAlert
              v-if="report"
              :color="report.tone"
              variant="subtle"
              :icon="report.tone === 'success' ? 'i-lucide-circle-check' : 'i-lucide-info'"
              :title="report.title"
            >
              <template v-if="report.details.length > 0" #description>
                <ul class="mt-1 flex list-disc flex-col gap-1 ps-5">
                  <li v-for="line in report.details" :key="line">{{ line }}</li>
                </ul>
              </template>
            </UAlert>
          </div>
          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            role="alert"
            icon="i-lucide-triangle-alert"
            :title="$t('content.actionFailed')"
            :description="failure"
          />

          <section v-if="data || status === 'pending'" :aria-busy="status === 'pending'" class="flex flex-col gap-3">
            <h2 ref="results" tabindex="-1" class="sr-only outline-none">{{ words.caption }}</h2>

            <div v-if="data" class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p role="status" class="text-sm text-toned">{{ $t('content.count', { n: data.total }, data.total) }}</p>
              <p v-if="view.search !== ''" class="flex flex-wrap items-center gap-x-3 text-sm text-default">
                <span>{{ $t('content.searchSummary', { query: view.search }) }}</span>
                <NuxtLink
                  :to="locationFor({ search: '' })"
                  class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
                >
                  {{ $t('content.searchClear') }}
                </NuxtLink>
              </p>
            </div>

            <div v-if="!data" class="flex flex-col gap-2" aria-hidden="true">
              <USkeleton
                v-for="row in 5"
                :key="row"
                role="presentation"
                aria-hidden="true"
                aria-label=""
                class="h-12 w-full"
              />
            </div>

            <div v-else-if="items.length === 0" class="flex max-w-prose flex-col gap-2 py-6">
              <p class="text-lg font-semibold text-highlighted">{{ inTrash ? words.emptyTrash : words.empty }}</p>
              <p v-if="filtered" class="text-base text-default">
                <NuxtLink
                  :to="{ path: route.path }"
                  class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline"
                >
                  {{ $t('content.showAll') }}
                </NuxtLink>
              </p>
            </div>

            <div v-else :class="status === 'pending' ? 'opacity-60' : ''">
              <ContentTable
                v-model:selected="selected"
                :type="type"
                :items="items"
                :view="view"
                :to="locationFor"
                :hidden-columns="screen.hiddenColumns"
                :selectable="selectable"
                :time-zone="data.timeZone"
                @quick-edit="quickEdit"
                @trash="trashOne"
                @restore="restoreOne"
                @remove="removeOne"
              />
            </div>

            <UPagination
              v-if="data && data.totalPages > 1"
              as="nav"
              :aria-label="$t('content.pagination')"
              :page="view.page"
              :total="data.total"
              :items-per-page="data.perPage"
              :sibling-count="1"
              show-edges
              :to="(page: number) => locationFor({ page })"
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
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
