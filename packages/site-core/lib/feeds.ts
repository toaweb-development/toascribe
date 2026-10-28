// The site's RSS 2.0, sitemap and robots.txt (M1.6, K-222, K-223), written from what the api gives (absolute addresses from
// PUBLIC_ORIGIN, never from a request's Host). Every text goes through xmlText (or xmlCdata for the HTML of a post), which escapes
// it and drops the characters XML does not allow, so a title with `&`, `<` or a control character cannot break the document.
import { BlockDocument } from '@toascribe/block-views'
import type { Block } from '@toascribe/blocks'
import { isSiteLocation, xmlCdata, xmlText } from '@toascribe/shared'
import type { ContentMediaRef, PublicFeed, PublicSitemapIndex, PublicSitemapPage } from '@toascribe/shared'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>'

/** RFC 822 dates, as RSS 2.0 asks (`Tue, 27 Oct 2026 12:00:00 GMT`). */
export function rfc822(iso: string): string {
  return new Date(iso).toUTCString()
}

/**
 * The addresses in HTML made absolute on `origin`: a feed is read away from the site, where `/uploads/…` means nothing. Only
 * `src`, `href`, `poster` and the entries of `srcset` that start with one `/` change (`//host` is another host, left alone).
 */
export function absoluteUrls(html: string, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  return html
    .replace(/\b(src|href|poster)="\/(?!\/)/g, (_match, name: string) => `${name}="${base}/`)
    .replace(
      /\bsrcset="([^"]*)"/g,
      (_match, set: string) =>
        `srcset="${set
          .split(',')
          .map((entry) => entry.trim().replace(/^\/(?!\/)/, `${base}/`))
          .join(', ')}"`,
    )
}

/** A post's whole text as the site draws it (the core block views, custom HTML as markup), for `content:encoded`. */
export async function feedHtml(
  blocks: readonly Record<string, unknown>[],
  media: readonly ContentMediaRef[],
  origin: string,
): Promise<string> {
  const app = createSSRApp({
    render: () => h(BlockDocument, { blocks: blocks as unknown as Block[], media, html: 'raw' }),
  })
  const html = (await renderToString(app)).replace(/<!--\[-->|<!--]-->|<!---->/g, '')
  return absoluteUrls(html, origin)
}

/** The RSS 2.0 document. `html` holds the rendered text of each item that has one, by its index. */
export function rssXml(feed: PublicFeed, html: ReadonlyMap<number, string>): string {
  const { channel } = feed
  const items = feed.items.map((item, index) => {
    const text = html.get(index)
    return [
      '<item>',
      `<title>${xmlText(item.title)}</title>`,
      `<link>${xmlText(item.link)}</link>`,
      item.author === '' ? '' : `<dc:creator>${xmlText(item.author)}</dc:creator>`,
      `<pubDate>${rfc822(item.publishedAt)}</pubDate>`,
      ...item.categories.map((name) => `<category>${xmlText(name)}</category>`),
      `<guid isPermaLink="false">${xmlText(item.guid)}</guid>`,
      `<description>${xmlText(item.excerpt)}</description>`,
      text === undefined ? '' : `<content:encoded>${xmlCdata(text)}</content:encoded>`,
      '</item>',
    ]
      .filter((line) => line !== '')
      .join('\n')
  })
  return [
    XML_HEAD,
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${xmlText(channel.title)}</title>`,
    `<atom:link href="${xmlText(channel.self)}" rel="self" type="application/rss+xml"/>`,
    `<link>${xmlText(channel.link)}</link>`,
    `<description>${xmlText(channel.description)}</description>`,
    channel.lastBuildDate === null ? '' : `<lastBuildDate>${rfc822(channel.lastBuildDate)}</lastBuildDate>`,
    `<language>${xmlText(channel.language)}</language>`,
    '<generator>toascribe</generator>',
    ...items,
    '</channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** The sitemap index (sitemaps.org 0.9). */
export function sitemapIndexXml(index: PublicSitemapIndex): string {
  return [
    XML_HEAD,
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...index.sitemaps.map((entry) => `<sitemap><loc>${xmlText(entry.loc)}</loc></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n')
}

/** One sitemap file. */
export function sitemapXml(page: PublicSitemapPage): string {
  return [
    XML_HEAD,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...page.urls.map(
      (url) =>
        `<url><loc>${xmlText(url.loc)}</loc>${url.lastmod === null ? '' : `<lastmod>${xmlText(url.lastmod)}</lastmod>`}</url>`,
    ),
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * robots.txt (Tor's decision, M1.6): with search engines welcome, everything but the admin and the sitemap's address; without,
 * `Disallow: /` for everyone, as WordPress writes when «Søkemotorsynlighet» is ticked. AI crawlers are not singled out (SEO
 * standard). Themes and extensions add lines in phase 3.
 */
/**
 * `/.well-known/security.txt` (M1.8, K-319; RFC 9116) from «Personvern»: Contact, Policy when there is one, Preferred-Languages,
 * Canonical, and Expires half a year ahead (the RFC asks for less than a year). Undefined without a contact: then the site has none.
 */
export function securityTxt(
  settings: {
    readonly securityTxt: { readonly contact: string; readonly policyUrl: string }
    readonly origin: string
    readonly locale?: string
  },
  now: Date,
): string | undefined {
  const { contact, policyUrl: policy } = settings.securityTxt
  if (contact === '') return undefined
  // Each value is one line: one with a line break or a control character (never stored, but the file must not depend on it) means
  // no file rather than a file with lines nobody wrote.
  const oneLine = (value: string) =>
    [...value].every((char) => {
      const code = char.codePointAt(0) ?? 0
      return code > 0x20 && (code < 0x7f || code > 0x9f) && code !== 0x2028 && code !== 0x2029
    })
  if (![contact, policy].every(oneLine)) return undefined
  const expires = new Date(now.getTime() + 182 * 24 * 60 * 60 * 1000)
  expires.setUTCHours(0, 0, 0, 0)
  return [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    ...(policy === '' ? [] : [`Policy: ${policy}`]),
    `Preferred-Languages: ${settings.locale === 'en' ? 'en' : 'no, en'}`,
    `Canonical: ${settings.origin}/.well-known/security.txt`,
    '',
  ].join('\n')
}

export function robotsTxt(settings: { readonly searchEngineVisible: boolean; readonly origin: string }): string {
  if (!settings.searchEngineVisible) return 'User-agent: *\nDisallow: /\n'
  const origin = settings.origin.replace(/\/+$/, '')
  return `User-agent: *\nDisallow: /admin/\n\nSitemap: ${origin}/sitemap.xml\n`
}

const FEED = /^(\/(?:[^?#]*\/)?)feed\/?$/
/** The longest address before `feed/` the api reads. */
const MAX_FEED_PREFIX = 2000

/**
 * What an address means as a feed: none (not a feed address), a 404, a redirect to the address with its closing slash (as
 * WordPress' `/feed` does), or the feed of the address before `feed/`. A path that is not plainly one on this site (`//host/feed`,
 * which `/.//host/feed` becomes once its dot segments are gone, or a backslash) is a 404 and never a redirect.
 */
export function feedTarget(
  pathname: string,
):
  { kind: 'none' } | { kind: 'not-found' } | { kind: 'redirect'; location: string } | { kind: 'feed'; prefix: string } {
  const found = FEED.exec(pathname)
  if (found === null) return { kind: 'none' }
  const location = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (!isSiteLocation(location)) return { kind: 'not-found' }
  if (!pathname.endsWith('/')) return { kind: 'redirect', location }
  const prefix = found[1] ?? '/'
  return prefix.length > MAX_FEED_PREFIX ? { kind: 'not-found' } : { kind: 'feed', prefix }
}
