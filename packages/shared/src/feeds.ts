// RSS, the sitemap and robots.txt (M1.6, K-222, K-223). The api gives the data as JSON (every address absolute, from PUBLIC_ORIGIN);
// the site writes the XML and the text (PLAN: «Nuxt-server-ruter fra API-et»). The escaping lives here, once, for both.
import { z } from 'zod'

import { ContentMediaRef } from './content.ts'
import { CacheTags } from './public.ts'

/** The most addresses in one sitemap file (Tor's decision, M1.6; WordPress' wp_sitemaps_get_max_urls() is 2000 too). */
export const SITEMAP_MAX_URLS = 2000

/** The parts of the sitemap, in the order of the index. */
export const SITEMAP_KINDS = ['posts', 'pages', 'categories', 'tags', 'authors'] as const
export const SitemapKind = z.enum(SITEMAP_KINDS)
export type SitemapKind = z.infer<typeof SitemapKind>

/**
 * Text as XML character data or an attribute value: the five special characters escaped, and the characters XML 1.0 does not allow
 * (C0 controls but tab, LF and CR; lone surrogates; U+FFFE and U+FFFF) removed, so a stray control character in a title cannot make
 * the whole feed unreadable.
 */
export function xmlText(value: string): string {
  return stripInvalidXml(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** The text without the characters XML 1.0 does not allow (see xmlText). */
export function stripInvalidXml(value: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return value.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
}

/** A CDATA section: `]]>` inside is split so the section cannot end early. */
export function xmlCdata(value: string): string {
  return `<![CDATA[${stripInvalidXml(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

const AbsoluteUrl = z.url({ protocol: /^https?$/ })

/** GET /public/feed?path=: a feed of posts (the site's, or an archive's: category, tag, author, date). */
export const PublicFeed = z.object({
  kind: z.literal('feed'),
  channel: z.object({
    title: z.string(),
    description: z.string(),
    /** The page the feed is of. */
    link: AbsoluteUrl,
    /** The feed's own address (atom:link rel="self"). */
    self: AbsoluteUrl,
    /** `nb-NO` style, from the site's language. */
    language: z.string(),
    /** The newest change of an item in it; null when it is empty. */
    lastBuildDate: z.iso.datetime().nullable(),
  }),
  /** «For hvert innlegg i en strøm, vis» (K-194): the excerpt only, or the whole text. */
  useExcerpt: z.boolean(),
  /** PUBLIC_ORIGIN, for the addresses inside the text (an image's `/uploads/...`). */
  origin: AbsoluteUrl,
  items: z.array(
    z.object({
      title: z.string(),
      link: AbsoluteUrl,
      /** As WordPress: the `?p=` address, which does not change with the permalinks. */
      guid: AbsoluteUrl,
      publishedAt: z.iso.datetime(),
      author: z.string(),
      categories: z.array(z.string()),
      /** Empty for a password-protected item. */
      excerpt: z.string(),
      /** The whole text (all of its pages); null for a password-protected item, or when the feed shows excerpts. */
      blocks: z.array(z.record(z.string(), z.unknown())).nullable(),
      media: z.array(ContentMediaRef),
    }),
  ),
  cacheTags: CacheTags,
})
export type PublicFeed = z.infer<typeof PublicFeed>

/** The feed, or where it moved (an archive's old address: its feed is under the new one). 404 when the address has no feed. */
export const PublicFeedResponse = z.discriminatedUnion('kind', [
  PublicFeed,
  z.object({ kind: z.literal('redirect'), location: z.string(), cacheTags: CacheTags }),
])
export type PublicFeedResponse = z.infer<typeof PublicFeedResponse>

/** GET /public/feed: which feed. `path` is the address before `feed/` (`/` for the site's). */
export const PublicFeedQuery = z.strictObject({ path: z.string().min(1).max(2000) })

/** GET /public/sitemap: the index (WordPress' wp-sitemap.xml); 404 when the site asks search engines not to index it. */
export const PublicSitemapIndex = z.object({
  sitemaps: z.array(z.object({ kind: SitemapKind, page: z.int().min(1), loc: AbsoluteUrl })),
  cacheTags: CacheTags,
})
export type PublicSitemapIndex = z.infer<typeof PublicSitemapIndex>

/** GET /public/sitemap/{kind}/{page}: one file of addresses (404 past the last page). */
export const PublicSitemapPage = z.object({
  urls: z.array(z.object({ loc: AbsoluteUrl, lastmod: z.iso.datetime().nullable() })).max(SITEMAP_MAX_URLS),
  cacheTags: CacheTags,
})
export type PublicSitemapPage = z.infer<typeof PublicSitemapPage>

/** The address of a sitemap file on the site. */
export function sitemapPath(kind: SitemapKind, page: number): string {
  return `/sitemap-${kind}-${String(page)}.xml`
}
