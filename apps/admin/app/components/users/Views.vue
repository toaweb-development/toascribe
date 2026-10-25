<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { UserRoleCounts, UserRoleOption } from '@toascribe/shared'

import type { UsersView } from '~/utils/users-query'

// The views above the table, as WordPress' users.php has them: «Alle (n) | Administrator (n) | Redaktør (n) | …», and «Ingen rolle (n)» when
// someone holds no role. The counts ignore the search and the page. They are links (a view is an address, workflows §7); the current
// one is marked with `aria-current` and with weight, not with colour alone.
const props = defineProps<{
  counts: UserRoleCounts
  roles: readonly UserRoleOption[]
  view: UsersView
  /** The address of a view: the others stay as they are, the page starts over. */
  to: (changes: Partial<UsersView>) => RouteLocationRaw
}>()

const { t } = useI18n()

interface ViewLink {
  key: string
  role: string | undefined
  label: string
  count: number
}

// WordPress' order: Alle, then the roles in the API's order (administrator first), and «Ingen rolle» last. A role nobody holds is not a view.
const links = computed<ViewLink[]>(() => [
  { key: 'all', role: undefined, label: t('users.views.all'), count: props.counts.all },
  ...props.roles.flatMap((role): ViewLink[] => {
    const count = props.counts.roles[role.slug]
    return count === undefined
      ? []
      : [{ key: role.slug, role: role.slug, label: roleLabel(t, role.slug, role.name), count }]
  }),
  ...(props.counts.none > 0
    ? [{ key: 'none', role: 'none', label: t('users.views.none'), count: props.counts.none }]
    : []),
])
</script>

<template>
  <nav :aria-label="$t('users.views.label')">
    <ul class="flex flex-wrap gap-x-1">
      <li v-for="link in links" :key="link.key">
        <NuxtLink
          :to="to({ role: link.role })"
          :aria-current="view.role === link.role ? 'page' : undefined"
          class="inline-flex min-h-11 items-center rounded-md px-2.5 text-base underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8"
          :class="view.role === link.role ? 'font-semibold text-highlighted underline' : 'text-primary'"
        >
          {{ $t('users.views.item', { name: link.label, n: link.count }) }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
