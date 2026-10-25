<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { UserListItem } from '@toascribe/shared'

import type { UsersSortColumn, UsersView } from '~/utils/users-query'

// The users, as WordPress' users.php: a table from `md` (checkbox, Brukernavn, Navn, E-post, Rolle, Innlegg) and, below `md`, one entry
// in a list for each account with the same facts and the same checkbox (workflows §29, ui-system §8.2: no table that scrolls sideways).
// Both are drawn from the same rows and one selection; the one that does not fit is `display: none`, so a screen reader meets each
// account once. Native checkboxes: Reka's checkbox writes an inline `style` into the server's HTML, which the CSP refuses.
const props = defineProps<{
  users: readonly UserListItem[]
  view: UsersView
  /** The address of a sorted list: the others stay as they are, the page starts over. */
  to: (changes: Partial<UsersView>) => RouteLocationRaw
  signedInId: string | undefined
  /** False for an account that cannot change roles: no checkboxes at all. */
  selectable: boolean
  /** The stored name of a role, for a role the admin has no translation for. */
  roleName: (slug: string) => string | undefined
}>()

const selected = defineModel<string[]>('selected', { required: true })

const { t } = useI18n()

const allSelected = computed(
  () => props.users.length > 0 && props.users.every((user) => selected.value.includes(user.id)),
)
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value)

function toggleAll(checked: boolean) {
  selected.value = checked ? props.users.map((user) => user.id) : []
}

const COLUMNS: { column: UsersSortColumn; label: () => string }[] = [
  { column: 'username', label: () => t('users.table.username') },
  { column: 'name', label: () => t('users.table.name') },
  { column: 'email', label: () => t('users.table.email') },
]

function sortLocation(column: UsersSortColumn): RouteLocationRaw {
  return props.to(sortUsersBy(props.view, column))
}

function ariaSort(column: UsersSortColumn) {
  return ariaSortOf(props.view, column)
}

function rolesOf(user: UserListItem): string {
  return rolesText(t, user.roles, props.roleName)
}

const checkboxClass =
  'size-5 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const checkboxHitClass = 'flex size-11 shrink-0 cursor-pointer items-center justify-center lg:size-8'
const linkClass = 'text-primary underline underline-offset-4 hover:no-underline'
</script>

<!-- Prettier writes <input /> and vue/html-self-closing forbids it: the checkboxes are the only void elements here. -->
<!-- eslint-disable vue/html-self-closing -->
<template>
  <div>
    <!-- From md: the table. -->
    <table class="hidden w-full table-auto text-start text-sm md:table">
      <caption class="sr-only">
        {{
          $t('users.table.caption')
        }}
      </caption>
      <thead>
        <tr class="border-b border-default text-start">
          <th v-if="selectable" scope="col" class="w-12 py-1 ps-1 pe-2 text-start">
            <label :class="checkboxHitClass">
              <input
                type="checkbox"
                :class="checkboxClass"
                :checked="allSelected"
                :indeterminate="someSelected"
                :aria-label="$t('users.table.selectAll')"
                @change="toggleAll(($event.target as HTMLInputElement).checked)"
              />
            </label>
          </th>
          <th
            v-for="entry in COLUMNS"
            :key="entry.column"
            scope="col"
            :aria-sort="ariaSort(entry.column)"
            class="px-2 py-2 text-start font-semibold text-highlighted"
          >
            <NuxtLink
              :to="sortLocation(entry.column)"
              class="inline-flex min-h-11 items-center gap-1 rounded-md underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8"
            >
              {{ entry.label() }}
              <UIcon
                v-if="ariaSort(entry.column) !== 'none'"
                :name="ariaSort(entry.column) === 'ascending' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
            </NuxtLink>
          </th>
          <th scope="col" class="px-2 py-2 text-start font-semibold text-highlighted">{{ $t('users.table.roles') }}</th>
          <th scope="col" class="px-2 py-2 text-end font-semibold text-highlighted">{{ $t('users.table.posts') }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr v-for="user in users" :key="user.id" :class="selected.includes(user.id) ? 'bg-elevated/50' : ''">
          <td v-if="selectable" class="py-1 ps-1 pe-2 align-middle">
            <label :class="checkboxHitClass">
              <input
                v-model="selected"
                type="checkbox"
                :value="user.id"
                :class="checkboxClass"
                :aria-label="$t('users.table.select', { user: user.username })"
              />
            </label>
          </td>
          <th scope="row" class="px-2 py-2 text-start align-middle font-medium text-highlighted wrap-anywhere">
            <span class="inline-flex flex-wrap items-center gap-2">
              {{ user.username }}
              <UBadge v-if="user.id === signedInId" color="neutral" variant="outline" size="md">
                {{ $t('users.you') }}
              </UBadge>
            </span>
          </th>
          <td class="px-2 py-2 align-middle text-default wrap-anywhere">{{ user.displayName }}</td>
          <td class="px-2 py-2 align-middle wrap-anywhere">
            <a :href="`mailto:${user.email}`" :class="linkClass">{{ user.email }}</a>
          </td>
          <td class="px-2 py-2 align-middle text-default">{{ rolesOf(user) }}</td>
          <td class="px-2 py-2 text-end align-middle text-default tabular-nums">{{ user.postCount }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Below md: the list. The same facts, the same checkbox; the sort is a row of links where the table has its headings. -->
    <div class="flex flex-col gap-3 md:hidden">
      <nav :aria-label="$t('users.sort.label')" class="flex flex-wrap items-center gap-x-1">
        <span class="text-sm text-toned">{{ $t('users.sort.by') }}</span>
        <NuxtLink
          v-for="entry in COLUMNS"
          :key="entry.column"
          :to="sortLocation(entry.column)"
          :aria-current="ariaSort(entry.column) === 'none' ? undefined : 'true'"
          class="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-base underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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
              {{ ariaSort(entry.column) === 'ascending' ? $t('users.sort.ascending') : $t('users.sort.descending') }}
            </span>
          </template>
        </NuxtLink>
      </nav>

      <label v-if="selectable" class="flex min-h-11 cursor-pointer items-center gap-3 text-base text-default">
        <span :class="checkboxHitClass">
          <input
            type="checkbox"
            :class="checkboxClass"
            :checked="allSelected"
            :indeterminate="someSelected"
            @change="toggleAll(($event.target as HTMLInputElement).checked)"
          />
        </span>
        {{ $t('users.table.selectAll') }}
      </label>

      <ul
        class="flex flex-col divide-y divide-default rounded-md border border-default"
        :aria-label="$t('users.table.caption')"
      >
        <li
          v-for="user in users"
          :key="user.id"
          class="flex items-start gap-1 p-2"
          :class="selected.includes(user.id) ? 'bg-elevated/50' : ''"
        >
          <label v-if="selectable" :class="checkboxHitClass">
            <input
              v-model="selected"
              type="checkbox"
              :value="user.id"
              :class="checkboxClass"
              :aria-label="$t('users.table.select', { user: user.username })"
            />
          </label>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pe-1" :class="selectable ? '' : 'ps-2'">
            <p class="flex flex-wrap items-center gap-2 font-medium text-highlighted wrap-anywhere">
              {{ user.username }}
              <UBadge v-if="user.id === signedInId" color="neutral" variant="outline" size="md">
                {{ $t('users.you') }}
              </UBadge>
            </p>
            <p v-if="user.displayName !== user.username" class="text-sm text-default wrap-anywhere">
              {{ user.displayName }}
            </p>
            <p class="text-sm wrap-anywhere">
              <a :href="`mailto:${user.email}`" :class="linkClass">{{ user.email }}</a>
            </p>
            <p class="text-sm text-default">{{ rolesOf(user) }}</p>
            <p class="text-sm text-toned">{{ $t('users.table.postsCount', user.postCount) }}</p>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
