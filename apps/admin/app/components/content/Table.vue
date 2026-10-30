<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { ContentListColumn, ContentListItem, ContentTypeKey } from '@toascribe/shared'

import type { ContentSortColumn, ContentView } from '~/utils/content-query'

// The items, as WordPress' edit.php: from `md` a table (checkbox, Tittel with its states and the row actions, Forfatter, Kategorier,
// Stikkord, Dato); below `md` the rows stack in the same table (BlekkTableFrame, workflows §29: no table that scrolls sideways): the
// checkbox and the title cell stay, with the status and date (BlekkRowMeta) and the row actions (BlekkRowActions, always shown there)
// under the title. From `md`, under a fine pointer, the actions show on hover or focus, as the sketch and WordPress have it.
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
const termLinkClass = 'text-accent-text hover:underline'

const SORTABLE: { column: ContentSortColumn; label: () => string }[] = [
  { column: 'title', label: () => t('content.columns.title') },
  { column: 'date', label: () => t('content.columns.date') },
]
const sortLocation = (column: ContentSortColumn) => props.to(sortContentBy(props.view, props.type, column))
const ariaSort = (column: ContentSortColumn) => ariaSortOfContent(props.view, props.type, column)

const checkboxHitClass =
  'flex size-control max-lg:size-control-main shrink-0 cursor-pointer items-center justify-center'
// The row's actions (M2.1, «Blekk»): 40 px high, shown under the pointer or while one of them has focus; on a screen without a pointer
// that hovers (a phone) they are always shown.
const actionClass =
  'inline-flex min-h-control max-lg:min-h-control-main items-center rounded-menu text-help text-accent-text hover:underline'
const dangerClass =
  'inline-flex min-h-control max-lg:min-h-control-main items-center rounded-menu text-help text-danger hover:underline'
</script>

<template>
  <BlekkTableFrame :label="typeText(t, type).caption">
    <table class="w-full table-auto md:min-w-176 text-start text-body">
      <caption class="sr-only">
        {{
          typeText(t, type).caption
        }}
      </caption>
      <thead>
        <tr class="border-b border-line">
          <th v-if="selectable" scope="col" class="w-14 py-1 ps-2 pe-1 text-start">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="allState"
                :aria-label="$t('content.table.selectAll')"
                @update:model-value="toggleAll($event === true)"
              />
            </label>
          </th>
          <th
            scope="col"
            :aria-sort="ariaSort('title')"
            class="px-3 py-2 text-start text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            <NuxtLink
              :to="sortLocation('title')"
              class="inline-flex min-h-control items-center gap-1 rounded-menu uppercase hover:text-heading hover:underline"
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
          <th
            v-if="showAuthor"
            scope="col"
            class="px-3 py-2 text-start max-md:hidden text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            {{ $t('content.columns.author') }}
          </th>
          <th
            v-if="showCategories"
            scope="col"
            class="px-3 py-2 text-start max-md:hidden text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            {{ $t('terms.categories.title') }}
          </th>
          <th
            v-if="showTags"
            scope="col"
            class="px-3 py-2 text-start max-md:hidden text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            {{ $t('terms.tags.title') }}
          </th>
          <th
            v-if="showDate"
            scope="col"
            :aria-sort="ariaSort('date')"
            class="px-3 py-2 text-start max-md:hidden text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            <NuxtLink
              :to="sortLocation('date')"
              class="inline-flex min-h-control items-center gap-1 rounded-menu uppercase hover:text-heading hover:underline"
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
      <tbody class="divide-y divide-divider">
        <tr
          v-for="item in items"
          :key="item.id"
          class="group"
          :class="selected.includes(item.id) ? 'bg-accent-weak' : 'hover:bg-sunken'"
        >
          <td v-if="selectable" class="py-1 ps-2 pe-1 align-top">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="selected.includes(item.id)"
                :aria-label="$t('content.table.select', { title: titleOf(t, item.title) })"
                @update:model-value="toggle(item.id, $event)"
              />
            </label>
          </td>
          <th scope="row" class="px-3 py-3 text-start align-top font-normal">
            <span class="flex flex-col gap-0.5">
              <span class="font-semibold text-heading wrap-anywhere">
                <NuxtLink v-if="item.can.edit && !inTrash" :to="editPath(item)" class="hover:underline">{{
                  label(item)
                }}</NuxtLink>
                <template v-else>{{ label(item) }}</template>
                <span v-for="state in states(item)" :key="state" class="font-normal text-secondary">
                  — {{ state }}</span
                >
              </span>
              <BlekkRowMeta v-if="showDate">
                <span>{{ dateLabel(t, item) }}</span>
                <span class="font-mono">{{ dateOf(item) }}</span>
              </BlekkRowMeta>
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
          <td v-if="showAuthor" class="max-md:hidden px-3 py-3 align-top text-heading wrap-anywhere">
            {{ authorsOf(item) }}
          </td>
          <td v-if="showCategories" class="max-md:hidden px-3 py-3 align-top wrap-anywhere">
            <template v-for="(term, index) in item.categories" :key="term.id">
              <span v-if="index > 0">, </span>
              <NuxtLink :to="termLink('category', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
            </template>
            <span v-if="item.categories.length === 0" class="text-secondary">—</span>
          </td>
          <td v-if="showTags" class="max-md:hidden px-3 py-3 align-top wrap-anywhere">
            <template v-for="(term, index) in item.tags" :key="term.id">
              <span v-if="index > 0">, </span>
              <NuxtLink :to="termLink('tag', term.id)" :class="termLinkClass">{{ term.name }}</NuxtLink>
            </template>
            <span v-if="item.tags.length === 0" class="text-secondary">—</span>
          </td>
          <td v-if="showDate" class="max-md:hidden px-3 py-3 align-top whitespace-nowrap">
            <span class="block text-help text-secondary">{{ dateLabel(t, item) }}</span>
            <span class="font-mono text-help text-heading">{{ dateOf(item) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </BlekkTableFrame>
</template>
