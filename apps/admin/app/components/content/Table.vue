<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { ContentListColumn, ContentListItem, ContentTypeKey } from '@toascribe/shared'

import type { ContentSortColumn, ContentView } from '~/utils/content-query'

// The items, as WordPress' edit.php: a table from `md` (checkbox, Tittel with its states and the row actions, Forfatter, Dato) and,
// below `md`, one entry per item in a list with the same facts, actions and checkbox (workflows §29: no table that scrolls sideways).
// Both are drawn from the same rows and one selection; the one that does not fit is `display: none`. The row actions are always
// shown, not only on hover as in WordPress, so they can be reached by touch and are read by a screen reader with their item.
const props = defineProps<{
  type: ContentTypeKey
  items: readonly ContentListItem[]
  view: ContentView
  to: (changes: Partial<ContentView>) => RouteLocationRaw
  hiddenColumns: readonly ContentListColumn[]
  /** False when no bulk action is open to the account: no checkboxes. */
  selectable: boolean
  timeZone: string
}>()

const selected = defineModel<string[]>('selected', { required: true })
const emit = defineEmits<{
  quickEdit: [item: ContentListItem]
  trash: [item: ContentListItem]
  restore: [item: ContentListItem]
  remove: [item: ContentListItem]
}>()

const { t, locale } = useI18n()

const inTrash = computed(() => props.view.status === 'trash')
const showAuthor = computed(() => !props.hiddenColumns.includes('author'))
const showCategories = computed(() => props.type === 'post' && !props.hiddenColumns.includes('categories'))
const showTags = computed(() => props.type === 'post' && !props.hiddenColumns.includes('tags'))
const showDate = computed(() => !props.hiddenColumns.includes('date'))

const allSelected = computed(
  () => props.items.length > 0 && props.items.every((item) => selected.value.includes(item.id)),
)
const allState = computed<boolean | 'indeterminate'>(() =>
  allSelected.value ? true : selected.value.length > 0 ? 'indeterminate' : false,
)

function toggleAll(checked: boolean) {
  selected.value = checked ? props.items.map((item) => item.id) : []
}

function toggle(id: string, checked: boolean | 'indeterminate') {
  const others = selected.value.filter((entry) => entry !== id)
  selected.value = checked === true ? [...others, id] : others
}

const formatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', timeZone: props.timeZone }),
)

const editPath = (item: ContentListItem) => `/${props.type === 'page' ? 'pages' : 'posts'}/${item.id}`
const label = (item: ContentListItem) => `${depthPrefix(item.depth)}${titleOf(t, item.title)}`
const states = (item: ContentListItem) => itemStates(t, item, props.view.status)
const authorsOf = (item: ContentListItem) => item.authors.map((author) => author.displayName).join(', ')
const dateOf = (item: ContentListItem) => formatter.value.format(new Date(shownDate(item)))

/** A term in a column links to the list filtered by it (WordPress' edit.php?category_name= / ?tag=). */
const termLink = (kind: 'category' | 'tag', id: string) =>
  props.to({ [kind]: id, ...(kind === 'category' ? { tag: '' } : { category: '' }) })
const termLinkClass = 'text-primary underline-offset-4 hover:underline'

const SORTABLE: { column: ContentSortColumn; label: () => string }[] = [
  { column: 'title', label: () => t('content.columns.title') },
  { column: 'date', label: () => t('content.columns.date') },
]
const sortLocation = (column: ContentSortColumn) => props.to(sortContentBy(props.view, props.type, column))
const ariaSort = (column: ContentSortColumn) => ariaSortOfContent(props.view, props.type, column)

const checkboxHitClass = 'flex size-11 shrink-0 cursor-pointer items-center justify-center lg:size-8'
const actionClass =
  'inline-flex min-h-11 items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-6'
const dangerClass =
  'inline-flex min-h-11 items-center rounded-sm text-sm text-error underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-6'
</script>

<template>
  <div>
    <table class="hidden w-full table-auto text-start text-sm md:table">
      <caption class="sr-only">
        {{
          typeText(t, type).caption
        }}
      </caption>
      <thead>
        <tr class="border-b border-default">
          <th v-if="selectable" scope="col" class="w-12 py-1 ps-1 pe-2 text-start">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="allState"
                :aria-label="$t('content.table.selectAll')"
                @update:model-value="toggleAll($event === true)"
              />
            </label>
          </th>
          <th scope="col" :aria-sort="ariaSort('title')" class="px-2 py-2 text-start font-semibold text-highlighted">
            <NuxtLink
              :to="sortLocation('title')"
              class="inline-flex min-h-11 items-center gap-1 rounded-md underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8"
            >
              {{ SORTABLE[0]?.label() }}
              <UIcon
                v-if="ariaSort('title') !== 'none'"
                :name="ariaSort('title') === 'ascending' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
            </NuxtLink>
          </th>
          <th v-if="showAuthor" scope="col" class="px-2 py-2 text-start font-semibold text-highlighted">
            {{ $t('content.columns.author') }}
          </th>
          <th v-if="showCategories" scope="col" class="px-2 py-2 text-start font-semibold text-highlighted">
            {{ $t('terms.categories.title') }}
          </th>
          <th v-if="showTags" scope="col" class="px-2 py-2 text-start font-semibold text-highlighted">
            {{ $t('terms.tags.title') }}
          </th>
          <th
            v-if="showDate"
            scope="col"
            :aria-sort="ariaSort('date')"
            class="px-2 py-2 text-start font-semibold text-highlighted"
          >
            <NuxtLink
              :to="sortLocation('date')"
              class="inline-flex min-h-11 items-center gap-1 rounded-md underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8"
            >
              {{ SORTABLE[1]?.label() }}
              <UIcon
                v-if="ariaSort('date') !== 'none'"
                :name="ariaSort('date') === 'ascending' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
            </NuxtLink>
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr v-for="item in items" :key="item.id" :class="selected.includes(item.id) ? 'bg-elevated/50' : ''">
          <td v-if="selectable" class="py-1 ps-1 pe-2 align-top">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="selected.includes(item.id)"
                :aria-label="$t('content.table.select', { title: titleOf(t, item.title) })"
                @update:model-value="toggle(item.id, $event)"
              />
            </label>
          </td>
          <th scope="row" class="px-2 py-2 text-start align-top font-normal">
            <span class="flex flex-col gap-1">
              <span class="font-semibold text-highlighted wrap-anywhere">
                <NuxtLink
                  v-if="item.can.edit && !inTrash"
                  :to="editPath(item)"
                  class="text-primary underline-offset-4 hover:underline"
                  >{{ label(item) }}</NuxtLink
                >
                <template v-else>{{ label(item) }}</template>
                <span v-for="state in states(item)" :key="state" class="font-normal text-toned"> — {{ state }}</span>
              </span>
              <ContentRowActions
                :item="item"
                :in-trash="inTrash"
                :edit-path="editPath(item)"
                :action-class="actionClass"
                :danger-class="dangerClass"
                @quick-edit="emit('quickEdit', item)"
                @trash="emit('trash', item)"
                @restore="emit('restore', item)"
                @remove="emit('remove', item)"
              />
            </span>
          </th>
          <td v-if="showAuthor" class="px-2 py-2 align-top text-default wrap-anywhere">{{ authorsOf(item) }}</td>
          <td v-if="showCategories" class="px-2 py-2 align-top wrap-anywhere">
            <template v-for="(term, index) in item.categories" :key="term.id">
              <span v-if="index > 0">, </span>
              <NuxtLink :to="termLink('category', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
            </template>
            <span v-if="item.categories.length === 0" class="text-toned">—</span>
          </td>
          <td v-if="showTags" class="px-2 py-2 align-top wrap-anywhere">
            <template v-for="(term, index) in item.tags" :key="term.id">
              <span v-if="index > 0">, </span>
              <NuxtLink :to="termLink('tag', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
            </template>
            <span v-if="item.tags.length === 0" class="text-toned">—</span>
          </td>
          <td v-if="showDate" class="px-2 py-2 align-top text-default">
            <span class="block text-toned">{{ dateLabel(t, item) }}</span>
            <span class="tabular-nums">{{ dateOf(item) }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="flex flex-col gap-3 md:hidden">
      <nav :aria-label="$t('content.table.sortLabel')" class="flex flex-wrap items-center gap-x-1">
        <span class="text-sm text-toned">{{ $t('content.table.sortBy') }}</span>
        <NuxtLink
          v-for="entry in SORTABLE"
          :key="entry.column"
          :to="sortLocation(entry.column)"
          :aria-current="ariaSort(entry.column) === 'none' ? undefined : 'true'"
          class="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-base underline-offset-4 hover:underline"
          :class="ariaSort(entry.column) === 'none' ? 'text-primary' : 'font-semibold text-highlighted underline'"
        >
          {{ entry.label() }}
          <template v-if="ariaSort(entry.column) !== 'none'">
            <UIcon
              :name="ariaSort(entry.column) === 'ascending' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="sr-only">
              {{
                ariaSort(entry.column) === 'ascending' ? $t('content.table.ascending') : $t('content.table.descending')
              }}
            </span>
          </template>
        </NuxtLink>
      </nav>

      <label v-if="selectable" class="flex min-h-11 cursor-pointer items-center gap-3 text-base text-default">
        <span :class="checkboxHitClass">
          <UCheckbox size="lg" :model-value="allState" @update:model-value="toggleAll($event === true)" />
        </span>
        {{ $t('content.table.selectAll') }}
      </label>

      <ul
        class="flex flex-col divide-y divide-default rounded-md border border-default"
        :aria-label="typeText(t, type).caption"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="flex items-start gap-1 p-2"
          :class="selected.includes(item.id) ? 'bg-elevated/50' : ''"
        >
          <label v-if="selectable" :class="checkboxHitClass">
            <UCheckbox
              size="lg"
              :model-value="selected.includes(item.id)"
              :aria-label="$t('content.table.select', { title: titleOf(t, item.title) })"
              @update:model-value="toggle(item.id, $event)"
            />
          </label>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pe-1" :class="selectable ? '' : 'ps-2'">
            <p class="font-semibold text-highlighted wrap-anywhere">
              <NuxtLink
                v-if="item.can.edit && !inTrash"
                :to="editPath(item)"
                class="text-primary underline-offset-4 hover:underline"
                >{{ label(item) }}</NuxtLink
              >
              <template v-else>{{ label(item) }}</template>
              <span v-for="state in states(item)" :key="state" class="font-normal text-toned"> — {{ state }}</span>
            </p>
            <p v-if="showAuthor" class="text-sm text-default wrap-anywhere">{{ authorsOf(item) }}</p>
            <p v-if="showCategories && item.categories.length > 0" class="text-sm wrap-anywhere">
              <span class="text-toned">{{ $t('terms.categories.title') }}: </span>
              <template v-for="(term, index) in item.categories" :key="term.id">
                <span v-if="index > 0">, </span>
                <NuxtLink :to="termLink('category', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
              </template>
            </p>
            <p v-if="showTags && item.tags.length > 0" class="text-sm wrap-anywhere">
              <span class="text-toned">{{ $t('terms.tags.title') }}: </span>
              <template v-for="(term, index) in item.tags" :key="term.id">
                <span v-if="index > 0">, </span>
                <NuxtLink :to="termLink('tag', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
              </template>
            </p>
            <p v-if="showDate" class="text-sm text-toned">{{ dateLabel(t, item) }} {{ dateOf(item) }}</p>
            <ContentRowActions
              :item="item"
              :in-trash="inTrash"
              :edit-path="editPath(item)"
              :action-class="actionClass"
              :danger-class="dangerClass"
              @quick-edit="emit('quickEdit', item)"
              @trash="emit('trash', item)"
              @restore="emit('restore', item)"
              @remove="emit('remove', item)"
            />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
