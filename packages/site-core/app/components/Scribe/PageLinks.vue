<script setup lang="ts">
// The pages of an item split by page breaks (K-227, WordPress' wp_link_pages()): `/slug/`, `/slug/2/`, …
import type { PublicContent } from '@toascribe/shared'

import { itemPage } from '../../lib/scribe'

defineProps<{ content: PublicContent }>()
const { t } = useI18n()
</script>

<template>
  <nav v-if="content.pages > 1" class="scribe-page-links" :aria-label="t('scribe.pages.label')">
    <ul>
      <li v-for="n in content.pages" :key="n">
        <span v-if="n === content.page" aria-current="page">{{ t('scribe.pagination.page', { page: n }) }}</span>
        <a v-else :href="itemPage(content.path, n)">{{ t('scribe.pagination.page', { page: n }) }}</a>
      </li>
    </ul>
  </nav>
</template>
