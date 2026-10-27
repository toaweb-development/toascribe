<script setup lang="ts">
import { jsonLdText, seoHead } from '../../../lib/seo'

// The core's part of every page's head (PLAN «Regler et tema må følge» 2, WordPress' wp_head()): the title after the site's name,
// the description, and no indexing of a search, a 404 or a preview. The toolbar for a signed-in person comes here too (K-032).
// «Tilpass» (M1.5): the site icon, and one `<style>` with the theme's colours and fonts and «Ekstra CSS». The style is always written,
// empty or not, so it carries the response's nonce and the admin's preview can change its text (a style element made later would
// have none, and the CSP would refuse it). Its text never holds `<` (customCssProblem, SiteCustomization).
// SEO (M1.6, K-224): canonical, Open Graph, Twitter, rel prev/next and JSON-LD, built by lib/seo.ts from what the page resolved.
const { t } = useI18n()
const settings = useSettings()
const customize = useCustomize()
const maintenance = useMaintenance()
const { kind, content, archive, preview } = useContent()

const { list } = useContent()
// The whole head of the page (lib/seo.ts): title, description, canonical, prev/next, Open Graph, Twitter and JSON-LD.
const head = computed(() =>
  settings.value === null
    ? undefined
    : seoHead({
        settings: settings.value,
        kind: maintenance.value ? 'maintenance' : kind.value,
        content: content.value,
        archive: archive.value,
        list: list.value,
        preview: preview.value,
        labels: {
          siteFallback: t('brand.name'),
          date: (date) => t('scribe.head.date', { date }),
          search: (query) => t('scribe.head.search', { query }),
          notFound: t('scribe.head.notFound'),
          maintenance: t('scribe.maintenance.title'),
        },
      }),
)
// A site without a name (it has not been given one) is called by the product's name, so no page is without a title (WCAG 2.4.2).
const siteTitle = computed(() => settings.value?.title || t('brand.name'))

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

const metaTags = computed(() => [
  ...(head.value?.description === undefined ? [] : [{ name: 'description', content: head.value.description }]),
  ...(head.value?.noindex === true ? [{ name: 'robots', content: 'noindex' }] : []),
  ...(head.value?.meta ?? []).map((tag) =>
    tag.property === undefined
      ? { key: tag.name ?? '', name: tag.name ?? '', content: tag.content }
      : { key: tag.property, property: tag.property, content: tag.content },
  ),
])
const linkTags = computed(() =>
  (head.value?.links ?? []).map((link) =>
    link.rel === 'canonical'
      ? { key: 'scribe-canonical', rel: 'canonical' as const, href: link.href }
      : link.rel === 'prev'
        ? { key: 'scribe-prev', rel: 'prev' as const, href: link.href }
        : { key: 'scribe-next', rel: 'next' as const, href: link.href },
  ),
)
const scriptTags = computed(() =>
  head.value?.jsonLd == null
    ? []
    : [{ key: 'scribe-jsonld', type: 'application/ld+json' as const, textContent: jsonLdText(head.value.jsonLd) }],
)
useHead({
  title: () => head.value?.title ?? siteTitle.value,
  meta: metaTags,
  link: [{ key: 'scribe-icon', rel: 'icon', href: () => customize.value.icon?.url }],
  script: scriptTags,
  style: [{ key: 'scribe-customize', id: 'scribe-customize', textContent: () => customize.value.css }],
})
useHead({ link: linkTags })
// The site as an oEmbed provider (M1.6): published, public content without a password names its `/oembed` answer.
const oembedLink = computed(() => {
  const canonical = head.value?.links.find((link) => link.rel === 'canonical')?.href
  const item = content.value
  if (canonical === undefined || item === undefined || item.protected || item.locked || preview.value) return []
  const origin = settings.value?.origin ?? ''
  return [
    {
      key: 'scribe-oembed',
      rel: 'alternate' as const,
      type: 'application/json+oembed',
      href: `${origin}/oembed?${new URLSearchParams({ url: canonical }).toString()}`,
      title: head.value?.title ?? '',
    },
  ]
})
useHead({ link: oembedLink })
</script>

<template>
  <ScribeToolbar />
</template>
