<script setup lang="ts">
// «Aktivitet» (M1.8, K-033; WordPress' Activity widget), as «Blekk» draws it (M2.1): the posts that will be published soon and the
// ones published last, five of each, in one list with the time in mono and a badge for the state. Through the content list, so the
// account sees only what the list would show it. Comments come with phase 3; there are none to show before then. For accounts that
// can write posts (`edit_posts`), as WordPress' list needs.
import type { ContentListItem } from '@toascribe/shared'

const contentApi = useContentApi()
const { t, locale } = useI18n()

const { data, status, error, refresh } = await useAsyncData('dashboard:activity', async () => {
  const [soon, recent] = await Promise.all([
    contentApi.list({ type: 'post', status: 'future', orderby: 'date', order: 'asc', per_page: 5 }),
    contentApi.list({ type: 'post', status: 'publish', orderby: 'date', order: 'desc', per_page: 5 }),
  ])
  return { soon: soon.items, recent: recent.items, timeZone: recent.timeZone }
})

const rows = computed(() => [
  ...(data.value?.soon ?? []).map((item) => ({ item, part: 'soon' as const })),
  ...(data.value?.recent ?? []).map((item) => ({ item, part: 'recent' as const })),
])

const format = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: data.value?.timeZone ?? 'UTC',
    }),
)
const when = (item: ContentListItem): string =>
  item.publishedAt === null ? '' : format.value.format(new Date(item.publishedAt))
const title = (item: ContentListItem) => (item.title === '' ? t('dashboard.activity.untitled') : item.title)
</script>

<template>
  <UCard as="section" aria-labelledby="activity-heading" :aria-busy="status === 'pending'">
    <template #header>
      <h2 id="activity-heading" class="text-card-title font-semibold text-heading">
        {{ $t('dashboard.activity.heading') }}
      </h2>
    </template>

    <div v-if="data">
      <p v-if="rows.length === 0" class="text-body text-secondary">
        {{ $t('dashboard.activity.empty') }}
      </p>
      <ul v-else class="-my-2 flex flex-col divide-y divide-divider">
        <li
          v-for="{ item, part } in rows"
          :key="`${part}:${item.id}`"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
        >
          <time :datetime="item.publishedAt ?? undefined" class="w-32 shrink-0 font-mono text-help text-secondary">
            {{ when(item) }}
          </time>
          <span class="min-w-0 flex-1 text-body text-heading">
            <ULink v-if="item.can.edit" :to="`/posts/${item.id}`" class="text-accent-text hover:underline">
              {{ title(item) }}
            </ULink>
            <template v-else>{{ title(item) }}</template>
            {{ ' ' }}{{ ACTIVITY_PARTS[part](t) }}
          </span>
          <UBadge :color="part === 'soon' ? 'info' : 'success'" variant="subtle" class="rounded-full">
            {{ ACTIVITY_BADGES[part](t) }}
          </UBadge>
        </li>
      </ul>
    </div>

    <div v-else-if="status === 'pending'" class="flex flex-col gap-2" aria-hidden="true">
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-56" />
      <USkeleton role="presentation" aria-hidden="true" aria-label="" class="h-5 w-48" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      role="alert"
      :title="$t('dashboard.activity.failed.title')"
    >
      <template #description>
        <p>{{ $t('dashboard.activity.failed.text') }}</p>
      </template>
      <template #actions>
        <UButton color="neutral" variant="outline" size="lg" class="min-h-control" @click="() => refresh()">
          {{ $t('dashboard.activity.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </UCard>
</template>
