<script setup lang="ts">
// The core's part of every page's head (PLAN «Regler et tema må følge» 2, WordPress' wp_head()): the title after the site's name,
// the description, and no indexing of a search, a 404 or a preview. The toolbar for a signed-in person comes here too (K-032).
// SEO in full (canonical, Open Graph, structured data) is M1.6.
const { t } = useI18n()
const settings = useSettings()
const { kind, content, archive, preview } = useContent()

const pageTitle = computed(() => {
  const found = archive.value
  if (content.value !== undefined) return content.value.seo.title ?? content.value.title
  if (found?.type === 'category' || found?.type === 'tag') return found.term.name
  if (found?.type === 'author') return found.author.displayName
  if (found?.type === 'date')
    return t('scribe.head.date', {
      date: [found.year, found.month, found.day].filter((part) => part !== null).join('-'),
    })
  if (found?.type === 'search') return t('scribe.head.search', { query: found.query })
  if (kind.value === '404') return t('scribe.head.notFound')
  return ''
})
// A site without a name (it has not been given one) is called by the product's name, so no page is without a title (WCAG 2.4.2).
const siteTitle = computed(() => settings.value?.title || t('brand.name'))
const description = computed(
  () => content.value?.seo.description ?? (content.value?.excerpt || settings.value?.tagline) ?? undefined,
)
const noindex = computed(
  () => preview.value || kind.value === '404' || kind.value === 'search' || content.value?.seo.noindex === true,
)

useHead({
  title: () => [pageTitle.value, siteTitle.value].filter((part) => part !== '').join(' – '),
  meta: [
    { name: 'description', content: () => description.value },
    { name: 'robots', content: () => (noindex.value ? 'noindex' : undefined) },
  ],
})
</script>

<template>
  <ScribeToolbar />
</template>
