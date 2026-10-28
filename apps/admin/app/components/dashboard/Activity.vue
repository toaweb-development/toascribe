<script setup lang="ts">
// «Aktivitet» (M1.8, K-033; WordPress' Activity widget): the posts that will be published soon and the ones published last, five of
// each, through the content list, so the account sees only what the list would show it. Comments come with phase 3; there are none
// to show before then. For accounts that can write posts (`edit_posts`), as WordPress' list needs.
import type { ContentListItem } from '@toascribe/shared'

const contentApi = useContentApi()
const { locale } = useI18n()

const { data, status, error, refresh } = await useAsyncData('dashboard:activity', async () => {
  const [soon, recent] = await Promise.all([
    contentApi.list({ type: 'post', status: 'future', orderby: 'date', order: 'asc', per_page: 5 }),
    contentApi.list({ type: 'post', status: 'publish', orderby: 'date', order: 'desc', per_page: 5 }),
  ])
  return { soon: soon.items, recent: recent.items, timeZone: recent.timeZone }
})

const format = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.value?.timeZone ?? 'UTC',
    }),
)
const when = (item: ContentListItem): string =>
  item.publishedAt === null ? '' : format.value.format(new Date(item.publishedAt))
</script>

<template>
  <UCard as="section" aria-labelledby="activity-heading" :aria-busy="status === 'pending'">
    <template #header>
      <h2 id="activity-heading" class="text-lg font-semibold text-highlighted">
        {{ $t('dashboard.activity.heading') }}
      </h2>
    </template>

    <div v-if="data" class="flex flex-col gap-4">
      <p v-if="data.soon.length === 0 && data.recent.length === 0" class="text-base text-default">
        {{ $t('dashboard.activity.empty') }}
      </p>
      <template v-for="part in ['soon', 'recent'] as const" :key="part">
        <section v-if="data[part].length > 0" :aria-labelledby="`activity-${part}`">
          <h3 :id="`activity-${part}`" class="text-base font-semibold text-highlighted">
            {{ $t(`dashboard.activity.${part}`) }}
          </h3>
          <ul class="mt-1 flex flex-col">
            <li v-for="item in data[part]" :key="item.id" class="flex flex-col gap-x-3 sm:flex-row sm:items-center">
              <span class="text-sm text-toned sm:w-44 sm:shrink-0">{{ when(item) }}</span>
              <ULink
                v-if="item.can.edit"
                :to="`/posts/${item.id}`"
                class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
              >
                {{ item.title === '' ? $t('dashboard.activity.untitled') : item.title }}
              </ULink>
              <span v-else class="inline-flex min-h-11 items-center lg:min-h-8">
                {{ item.title === '' ? $t('dashboard.activity.untitled') : item.title }}
              </span>
            </li>
          </ul>
        </section>
      </template>
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
        <UButton color="neutral" variant="outline" size="lg" class="min-h-11" @click="() => refresh()">
          {{ $t('dashboard.activity.failed.retry') }}
        </UButton>
      </template>
    </UAlert>
  </UCard>
</template>
