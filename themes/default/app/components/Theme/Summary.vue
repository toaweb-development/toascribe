<script setup lang="ts">
// One item in a list: its title as a link, the meta, and the text before «Les mer» (K-107) or the excerpt. A protected item shows
// its title only, with a note, until its password is given.
import type { PublicSummary } from '@toascribe/shared'

defineProps<{ item: PublicSummary }>()
const { t } = useI18n()
</script>

<template>
  <article class="theme-summary">
    <h2 class="theme-summary-title">
      <a :href="item.path">{{ item.title || t('theme.untitled') }}</a>
    </h2>
    <ThemeMeta v-if="item.type === 'post'" :item="item" />
    <p v-if="item.locked" class="theme-note">{{ t('theme.protected') }}</p>
    <template v-else-if="item.teaser">
      <ScribeBlocks :blocks="item.teaser" />
      <p>
        <a :href="item.path" class="theme-more">
          {{ item.moreText ?? t('scribe.more') }}<span class="theme-sr-only"> – {{ item.title }}</span>
        </a>
      </p>
    </template>
    <p v-else-if="item.excerpt">{{ item.excerpt }}</p>
  </article>
</template>
