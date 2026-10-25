<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { UsersView } from '~/utils/users-query'

// Page links under the table (WordPress' «1 2 3 … Neste »). Real links with the page in the address (workflows §7), so a page can be
// bookmarked and the back button works. Only drawn when there is more than one page.
const props = defineProps<{
  view: UsersView
  total: number
  perPage: number
  /** The address of a page: everything else stays as it is. */
  to: (changes: Partial<UsersView>) => RouteLocationRaw
}>()

const count = computed(() => pageCountOf(props.total, props.perPage))
const items = computed(() => pageItems(props.view.page, count.value))

const linkClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-base underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary lg:min-h-8 lg:min-w-8'
</script>

<template>
  <nav v-if="count > 1" :aria-label="$t('users.pagination.label')">
    <ul class="flex flex-wrap items-center gap-1">
      <li v-if="view.page > 1">
        <NuxtLink :to="to({ page: view.page - 1 })" :class="[linkClass, 'gap-1 text-primary']" rel="prev">
          <UIcon name="i-lucide-chevron-left" class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('users.pagination.previous') }}
        </NuxtLink>
      </li>
      <template v-for="(item, index) in items" :key="item === 'gap' ? `gap-${index}` : item">
        <li v-if="item === 'gap'" aria-hidden="true" class="px-1 text-toned">
          <UIcon name="i-lucide-ellipsis" class="size-4" />
        </li>
        <li v-else>
          <NuxtLink
            :to="to({ page: item })"
            :aria-label="$t('users.pagination.page', { n: item })"
            :aria-current="item === view.page ? 'page' : undefined"
            :class="[
              linkClass,
              item === view.page ? 'bg-elevated font-semibold text-highlighted underline' : 'text-primary',
            ]"
          >
            {{ item }}
          </NuxtLink>
        </li>
      </template>
      <li v-if="view.page < count">
        <NuxtLink :to="to({ page: view.page + 1 })" :class="[linkClass, 'gap-1 text-primary']" rel="next">
          {{ $t('users.pagination.next') }}
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
