<script setup lang="ts">
// The core's part of every page's head (PLAN «Regler et tema må følge» 2, WordPress' wp_head()): the title after the site's name,
// the description, and no indexing of a search, a 404 or a preview. The toolbar for a signed-in person comes here too (K-032).
// «Tilpass» (M1.5): the site icon, and one `<style>` with the theme's colours and fonts and «Ekstra CSS». The style is always written,
// empty or not, so it carries the response's nonce and the admin's preview can change its text (a style element made later would
// have none, and the CSP would refuse it). Its text never holds `<` (customCssProblem, SiteCustomization).
// SEO in full (canonical, Open Graph, structured data) is M1.6.
const { t } = useI18n()
const settings = useSettings()
const customize = useCustomize()
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
  () =>
    settings.value?.searchEngineVisible === false ||
    preview.value ||
    kind.value === '404' ||
    kind.value === 'search' ||
    content.value?.seo.noindex === true,
)

// The feeds (K-222): the site's, and the archive's own on a category, tag or author archive, as WordPress' feed_links_extra().
const feedLinks = computed(() => {
  const found = archive.value
  const own =
    found?.type === 'category' || found?.type === 'tag'
      ? { name: found.term.name, path: found.term.path }
      : found?.type === 'author'
        ? { name: found.author.displayName, path: found.author.path }
        : undefined
  return [
    { key: 'scribe-feed', title: t('scribe.head.feed', { site: siteTitle.value }), href: '/feed/' },
    ...(own === undefined
      ? []
      : [
          {
            key: 'scribe-archive-feed',
            title: t('scribe.head.archiveFeed', { site: siteTitle.value, name: own.name }),
            href: `${own.path}feed/`,
          },
        ]),
  ].map((link) => ({ ...link, rel: 'alternate' as const, type: 'application/rss+xml' }))
})
useHead({ link: feedLinks })

useHead({
  title: () => [pageTitle.value, siteTitle.value].filter((part) => part !== '').join(' – '),
  meta: [
    { name: 'description', content: () => description.value },
    { name: 'robots', content: () => (noindex.value ? 'noindex' : undefined) },
  ],
  link: [{ key: 'scribe-icon', rel: 'icon', href: () => customize.value.icon?.url }],
  style: [{ key: 'scribe-customize', id: 'scribe-customize', textContent: () => customize.value.css }],
})
</script>

<template>
  <ScribeToolbar />
</template>
