<script setup lang="ts">
// One post or page: its title as the page's one <h1>, the meta of a post, then the form of a protected item or the blocks of the
// page shown (K-227) with the links to the other pages. A preview says so.
const props = withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
const { t } = useI18n()
const { content, blocks, preview } = useContent()
</script>

<template>
  <article v-if="content" class="theme-entry" :class="{ 'is-wide': props.wide }">
    <p v-if="preview" class="theme-preview" role="status">{{ t('scribe.preview') }}</p>
    <h1 class="theme-entry-title">{{ content.title || t('theme.untitled') }}</h1>
    <ThemeMeta v-if="content.type === 'post'" :item="content" />
    <ScribePasswordForm v-if="content.locked" :content-id="content.id" />
    <template v-else>
      <ScribeBlocks :blocks="blocks" :media="content.media" />
      <ScribePageLinks :content="content" />
    </template>
    <p v-if="content.tags.length > 0" class="theme-tags">
      <span>{{ t('theme.tags') }} </span>
      <template v-for="(term, index) in content.tags" :key="term.id">
        <span v-if="index > 0">, </span><a :href="term.path">{{ term.name }}</a>
      </template>
    </p>
  </article>
</template>
