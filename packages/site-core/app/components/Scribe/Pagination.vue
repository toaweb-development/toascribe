<script setup lang="ts">
// The pages of an archive or a search (PLAN «Regler» 4: the core's pagination, which a theme uses or overrides): previous, the
// numbers around the current page, next. WordPress' addresses: `/page/2/`, the search kept.
import type { PublicList } from '@toascribe/shared'

import { archivePage } from '../../lib/scribe'

const props = defineProps<{ list: PublicList }>()
const { t } = useI18n()
const route = useRoute()
const { archive } = useContent()

const search = computed(() => (archive.value?.type === 'search' ? archive.value.query : undefined))
const href = (page: number) => archivePage(route.path, page, search.value)
const numbers = computed(() => {
  const { page, pages } = props.list
  const shown = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  return [...shown].sort((a, b) => a - b)
})
</script>

<template>
  <nav v-if="list.pages > 1" class="scribe-pagination" :aria-label="t('scribe.pagination.label')">
    <a v-if="list.page > 1" class="scribe-pagination-previous" :href="href(list.page - 1)" rel="prev">
      {{ t('scribe.pagination.previous') }}
    </a>
    <ul>
      <li v-for="n in numbers" :key="n">
        <span v-if="n === list.page" aria-current="page">{{ t('scribe.pagination.page', { page: n }) }}</span>
        <a v-else :href="href(n)">{{ t('scribe.pagination.page', { page: n }) }}</a>
      </li>
    </ul>
    <a v-if="list.page < list.pages" class="scribe-pagination-next" :href="href(list.page + 1)" rel="next">
      {{ t('scribe.pagination.next') }}
    </a>
  </nav>
</template>
