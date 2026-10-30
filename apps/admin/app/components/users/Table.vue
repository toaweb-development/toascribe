<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { UserListItem } from '@toascribe/shared'

import type { UsersSortColumn, UsersView } from '~/utils/users-query'

// The users, as WordPress' users.php: from `md` a table (checkbox, Brukernavn, Navn, E-post, Rolle, Innlegg); below `md` the rows
// stack in the same table (BlekkTableFrame, workflows §29: no table that scrolls sideways): the checkbox and the username cell stay,
// with the name and role (BlekkRowMeta) and «Slett» (BlekkRowActions) under it. The table is hand-built so the checkbox column is the
// one source of the selection (the checkboxes themselves are Nuxt UI's `UCheckbox`).
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
  /** `delete_users`: a «Slett» link under every account but one's own (WordPress' row action). */
  mayDelete?: boolean
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

function toggle(id: string, checked: boolean | 'indeterminate') {
  const others = selected.value.filter((entry) => entry !== id)
  selected.value = checked === true ? [...others, id] : others
}

/** The select-all box: ticked for all, dashed for some. */
const allState = computed<boolean | 'indeterminate'>(() =>
  allSelected.value ? true : someSelected.value ? 'indeterminate' : false,
)

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

/** The 40 px area around a box: a press anywhere in it reaches the box. */
const checkboxHitClass =
  'flex size-control max-lg:size-control-main shrink-0 cursor-pointer items-center justify-center'
const linkClass = 'text-accent-text hover:underline'
</script>

<template>
  <BlekkTableFrame :label="$t('users.table.caption')">
    <table class="w-full table-auto md:min-w-176 text-start text-body">
      <caption class="sr-only">
        {{
          $t('users.table.caption')
        }}
      </caption>
      <thead>
        <tr class="border-b border-line text-start">
          <th v-if="selectable" scope="col" class="w-14 py-1 ps-2 pe-1 text-start">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="allState"
                :aria-label="$t('users.table.selectAll')"
                @update:model-value="toggleAll($event === true)"
              />
            </label>
          </th>
          <th
            v-for="(entry, index) in COLUMNS"
            :key="entry.column"
            scope="col"
            :aria-sort="ariaSort(entry.column)"
            :class="index > 0 ? 'max-md:hidden' : ''"
            class="px-3 py-2 text-start text-badge font-semibold tracking-wide text-secondary uppercase"
          >
            <NuxtLink
              :to="sortLocation(entry.column)"
              class="inline-flex min-h-control items-center gap-1 rounded-menu uppercase hover:text-heading hover:underline"
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
          <th
            scope="col"
            class="px-3 py-2 text-start text-badge font-semibold tracking-wide text-secondary uppercase max-md:hidden"
          >
            {{ $t('users.table.roles') }}
          </th>
          <th
            scope="col"
            class="px-3 py-2 text-end text-badge font-semibold tracking-wide text-secondary uppercase max-md:hidden"
          >
            {{ $t('users.table.posts') }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-divider">
        <tr
          v-for="user in users"
          :key="user.id"
          class="group"
          :class="selected.includes(user.id) ? 'bg-accent-weak' : 'hover:bg-sunken'"
        >
          <td v-if="selectable" class="py-1 ps-2 pe-1 align-middle">
            <label :class="checkboxHitClass">
              <UCheckbox
                size="lg"
                :model-value="selected.includes(user.id)"
                :aria-label="$t('users.table.select', { user: user.username })"
                @update:model-value="toggle(user.id, $event)"
              />
            </label>
          </td>
          <th scope="row" class="px-3 py-3 text-start align-middle font-semibold text-heading wrap-anywhere">
            <span class="inline-flex flex-wrap items-center gap-2">
              <UAvatar
                :src="user.avatarUrl ?? undefined"
                :alt="user.displayName"
                size="sm"
                :ui="{ fallback: 'text-default' }"
              />
              {{ user.username }}
              <UBadge v-if="user.id === signedInId" color="neutral" variant="outline" size="md">
                {{ $t('users.you') }}
              </UBadge>
            </span>
            <BlekkRowMeta class="mt-0.5 font-normal">
              <span>{{ user.displayName }}</span>
              <span>{{ rolesOf(user) }}</span>
            </BlekkRowMeta>
            <BlekkRowActions
              v-if="mayDelete && user.id !== signedInId"
              class="font-normal"
              :label="$t('content.actions.label', { title: user.username })"
            >
              <li>
                <NuxtLink
                  :to="`/users/${user.id}/delete`"
                  class="inline-flex min-h-control items-center rounded-menu text-help text-danger hover:underline max-lg:min-h-control-main"
                  :aria-label="$t('users.delete.rowLabel', { user: user.username })"
                >
                  {{ $t('users.delete.row') }}
                </NuxtLink>
              </li>
            </BlekkRowActions>
          </th>
          <td class="px-3 py-3 align-middle text-heading wrap-anywhere max-md:hidden">{{ user.displayName }}</td>
          <td class="px-3 py-3 align-middle wrap-anywhere max-md:hidden">
            <a :href="`mailto:${user.email}`" :class="[linkClass, 'inline-flex min-h-control items-center']">{{
              user.email
            }}</a>
          </td>
          <td class="px-3 py-3 align-middle text-heading max-md:hidden">{{ rolesOf(user) }}</td>
          <td class="px-3 py-3 text-end align-middle font-mono text-heading max-md:hidden">{{ user.postCount }}</td>
        </tr>
      </tbody>
    </table>
  </BlekkTableFrame>
</template>
