<script setup lang="ts">
// The counts as four cards (M2.1, «Blekk»; WordPress' «I korte trekk»): posts and pages (all but the bin, and how many are
// published), comments (approved, and how many wait), users (all, and how many administrators). A card the account may not see is
// not drawn: posts need `edit_posts`, pages `edit_pages`, comments `moderate_comments` (the glance leaves them out), users
// `list_users`. The totals come from the lists' own counts, so they match the tabs there.
import type { GlanceResponse } from '@toascribe/shared'

/** The glance the dashboard loaded (`dashboard:glance`), whether it is loading, and whether it failed. */
const props = defineProps<{ glance: GlanceResponse | undefined; glancePending: boolean; glanceFailed: boolean }>()

const { t } = useI18n()
const auth = useAuth()
const contentApi = useContentApi()
const usersApi = useUsersApi()
const can = (capability: string) =>
  auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes(capability)

const {
  data: totals,
  status,
  error,
  refresh,
} = await useAsyncData('dashboard:totals', async () => {
  const [posts, pages, users] = await Promise.all([
    can('edit_posts') ? contentApi.list({ type: 'post', per_page: 1 }).then((list) => list.counts) : undefined,
    can('edit_pages') ? contentApi.list({ type: 'page', per_page: 1 }).then((list) => list.counts) : undefined,
    can('list_users')
      ? usersApi.list({ orderby: 'username', order: 'asc', page: 1, per_page: 1 }).then((list) => list.roleCounts)
      : undefined,
  ])
  return { posts, pages, users }
})

interface Card {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly detail: string
  readonly to?: string
}
const cards = computed<Card[]>(() => {
  const glance = props.glance
  const list: Card[] = []
  const posts = totals.value?.posts
  if (posts) {
    list.push({
      key: 'posts',
      label: t('dashboard.stats.posts'),
      value: posts.all,
      detail: t('dashboard.stats.published', { n: posts.publish }),
      to: '/posts',
    })
  }
  const pages = totals.value?.pages
  if (pages) {
    list.push({
      key: 'pages',
      label: t('dashboard.stats.pages'),
      value: pages.all,
      detail: t('dashboard.stats.published', { n: pages.publish }),
      to: '/pages',
    })
  }
  if (glance?.comments) {
    list.push({
      key: 'comments',
      label: t('dashboard.stats.comments'),
      value: glance.comments.approved,
      detail: t('dashboard.stats.pending', { n: glance.comments.pending }),
    })
  }
  const users = totals.value?.users
  if (users) {
    const admins = users.roles['administrator'] ?? 0
    list.push({
      key: 'users',
      label: t('dashboard.stats.users'),
      value: users.all,
      detail: t('dashboard.stats.administrators', admins),
      to: '/users',
    })
  }
  return list
})
async function retry(): Promise<void> {
  await Promise.all([refresh(), refreshNuxtData('dashboard:glance')])
}
const failed = computed(() => error.value !== undefined && error.value !== null)
const pending = computed(() => status.value === 'pending' || props.glancePending)
</script>

<template>
  <section aria-labelledby="stats-heading" :aria-busy="pending">
    <h2 id="stats-heading" class="sr-only">{{ $t('dashboard.stats.heading') }}</h2>

    <ul v-if="cards.length > 0" class="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
      <li
        v-for="card in cards"
        :key="card.key"
        class="relative flex flex-col gap-2 rounded-card border border-line bg-surface p-4 sm:p-5"
      >
        <NuxtLink
          v-if="card.to"
          :to="card.to"
          class="text-help text-secondary after:absolute after:inset-0 after:rounded-card hover:underline"
        >
          {{ card.label }}
        </NuxtLink>
        <span v-else class="text-help text-secondary">{{ card.label }}</span>
        <span class="text-figure font-semibold tabular-nums text-heading">{{ card.value }}</span>
        <span class="text-help text-secondary">{{ card.detail }}</span>
      </li>
    </ul>

    <div v-else-if="pending" class="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6" aria-hidden="true">
      <USkeleton
        v-for="n in 4"
        :key="n"
        role="presentation"
        aria-hidden="true"
        aria-label=""
        class="h-28 rounded-card"
      />
    </div>

    <UAlert
      v-if="failed || props.glanceFailed"
      color="error"
      variant="subtle"
      role="alert"
      class="mt-4"
      :title="$t('dashboard.stats.failed.title')"
    >
      <template #description>
        <p>{{ $t('dashboard.stats.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-control" @click="retry">
          {{ $t('dashboard.stats.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </section>
</template>
