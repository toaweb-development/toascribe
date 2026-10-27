<script setup lang="ts">
// The core view of the Query Loop (K-085): the published items the block asks for, read when the page is shown (useQuery), each
// with its title as a link, the date and the excerpt as the block says. A theme replaces it with `blocks/query/View.vue`.
import type { Block } from '@toascribe/blocks'
import type { PublicQueryInput } from '@toascribe/shared'

const props = defineProps<{ block: Block; context: unknown }>()
const { t } = useI18n()
const settings = useSettings()

const attr = <T,>(key: string, fallback: T): T | string => {
  const value = props.block.attrs[key]
  return (typeof value === typeof fallback ? value : fallback) as T
}
const query = computed<PublicQueryInput>(() => {
  const sticky = attr('sticky', 'include')
  const category = attr('category', '')
  const tag = attr('tag', '')
  return {
    type: attr('postType', 'post') === 'page' ? 'page' : 'post',
    per_page: attr('perPage', 5),
    orderby: attr('orderBy', 'date') === 'title' ? 'title' : 'date',
    order: attr('order', 'desc') === 'asc' ? 'asc' : 'desc',
    ...(category === '' ? {} : { category }),
    ...(tag === '' ? {} : { tag }),
    ...(sticky === 'exclude' ? { exclude_sticky: 'true' } : sticky === 'first' ? { sticky_first: 'true' } : {}),
  }
})
const { data } = await useQuery(query)

const format = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(settings.value?.locale ?? 'nb', {
      dateStyle: 'long',
      timeZone: settings.value?.timezone ?? 'UTC',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}
</script>

<template>
  <ul v-if="data && data.items.length > 0" class="block-query">
    <li v-for="item in data.items" :key="item.id" class="block-query-item">
      <a :href="item.path" class="block-query-title">{{ item.title || t('scribe.query.untitled') }}</a>
      <time v-if="attr('showDate', true)" :datetime="item.publishedAt">{{ format(item.publishedAt) }}</time>
      <p v-if="attr('showExcerpt', true) && item.excerpt">{{ item.excerpt }}</p>
    </li>
  </ul>
  <p v-else class="block-query is-empty">{{ t('scribe.query.empty') }}</p>
</template>
