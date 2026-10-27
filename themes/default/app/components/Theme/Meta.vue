<script setup lang="ts">
// When an item was published, by whom, and in which categories and tags: in the site's time zone and language.
import type { PublicSummary } from '@toascribe/shared'

const props = defineProps<{ item: PublicSummary }>()
const { t } = useI18n()
const settings = useSettings()

const date = computed(() => {
  const at = new Date(props.item.publishedAt)
  try {
    return new Intl.DateTimeFormat(settings.value?.locale ?? 'nb', {
      dateStyle: 'long',
      timeZone: settings.value?.timezone ?? 'UTC',
    }).format(at)
  } catch {
    return new Intl.DateTimeFormat('nb', { dateStyle: 'long', timeZone: 'UTC' }).format(at)
  }
})
</script>

<template>
  <p class="theme-meta">
    <time :datetime="item.publishedAt">{{ date }}</time>
    <template v-if="item.authors.length > 0">
      <span aria-hidden="true"> · </span>
      <span>{{ t('theme.by') }} </span>
      <template v-for="(author, index) in item.authors" :key="author.id">
        <span v-if="index > 0">, </span><a :href="author.path">{{ author.displayName }}</a>
      </template>
    </template>
    <template v-if="item.categories.length > 0">
      <span aria-hidden="true"> · </span>
      <span>{{ t('theme.in') }} </span>
      <template v-for="(term, index) in item.categories" :key="term.id">
        <span v-if="index > 0">, </span><a :href="term.path">{{ term.name }}</a>
      </template>
    </template>
  </p>
</template>
