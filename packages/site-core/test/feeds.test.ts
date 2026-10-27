// @vitest-environment jsdom
// The site's RSS, sitemap and robots.txt (M1.6): the documents are well-formed XML (parsed by jsdom's XML parser, which refuses
// anything that is not), RSS 2.0 as its specification asks (checked here, locally, with no web service), every text escaped and
// stripped of the characters XML does not allow, the text of a post with absolute addresses, and robots.txt in both states.
import { createBlock } from '@toascribe/blocks'
import type { PublicFeed } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import {
  absoluteUrls,
  feedHtml,
  feedTarget,
  rfc822,
  robotsTxt,
  rssXml,
  sitemapIndexXml,
  sitemapXml,
} from '../lib/feeds'

const ORIGIN = 'https://blogg.example'

/** The document as an XML parser reads it; a parse error fails the test. */
function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const error = doc.getElementsByTagName('parsererror')[0]
  expect(error?.textContent ?? '', 'well-formed XML').toBe('')
  return doc
}

const RFC822 =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/

/** RSS 2.0 (https://www.rssboard.org/rss-specification): what a reader relies on. */
function expectRss2(doc: Document): void {
  const rss = doc.documentElement
  expect(rss.tagName).toBe('rss')
  expect(rss.getAttribute('version')).toBe('2.0')
  const channels = [...rss.children].filter((child) => child.tagName === 'channel')
  expect(channels).toHaveLength(1)
  const channel = channels[0]
  if (channel === undefined) throw new Error('no channel')
  const child = (parent: Element, name: string) => [...parent.children].filter((element) => element.tagName === name)
  for (const required of ['title', 'link', 'description']) expect(child(channel, required), required).toHaveLength(1)
  expect(new URL(child(channel, 'link')[0]?.textContent ?? '').protocol).toBe('https:')
  const self = child(channel, 'atom:link')[0]
  expect(self?.getAttribute('rel')).toBe('self')
  for (const date of [...child(channel, 'lastBuildDate'), ...channel.getElementsByTagName('pubDate')]) {
    expect(date.textContent).toMatch(RFC822)
  }
  for (const item of child(channel, 'item')) {
    // An item has a title or a description; ours have both, a link and a guid.
    expect(child(item, 'title')).toHaveLength(1)
    expect(child(item, 'description')).toHaveLength(1)
    expect(new URL(child(item, 'link')[0]?.textContent ?? '').origin).toBe(ORIGIN)
    expect(child(item, 'guid')[0]?.getAttribute('isPermaLink')).toBe('false')
  }
}

function feedOf(items: PublicFeed['items']): PublicFeed {
  return {
    kind: 'feed',
    channel: {
      title: 'Fjell & fjord <blogg>',
      description: 'Turer\u0001 og «topper»',
      link: `${ORIGIN}/`,
      self: `${ORIGIN}/feed/`,
      language: 'nb',
      lastBuildDate: '2026-10-27T10:00:00.000Z',
    },
    useExcerpt: false,
    origin: ORIGIN,
    items,
    cacheTags: ['settings'],
  }
}

const ITEM: PublicFeed['items'][number] = {
  title: 'Hei & <b>fjellet</b> \u0007',
  link: `${ORIGIN}/hei/`,
  guid: `${ORIGIN}/?p=12`,
  publishedAt: '2026-10-26T08:30:00.000Z',
  author: 'Kari "K" Nordmann',
  categories: ['Nyheter & sånt', 'fjell'],
  excerpt: 'Utdrag med ]]> og <tegn>',
  blocks: null,
  media: [],
}

describe('rssXml', () => {
  it('is well-formed RSS 2.0 with every text escaped and control characters dropped', () => {
    const xml = rssXml(
      feedOf([ITEM]),
      new Map([[0, '<p>Tekst med ]]> inni og <a href="https://x.example/">lenke</a></p>']]),
    )
    const doc = parseXml(xml)
    expectRss2(doc)
    expect(doc.getElementsByTagName('title')[0]?.textContent).toBe('Fjell & fjord <blogg>')
    expect(doc.getElementsByTagName('description')[0]?.textContent).toBe('Turer og «topper»')
    const item = doc.getElementsByTagName('item')[0]
    expect(item?.getElementsByTagName('title')[0]?.textContent).toBe('Hei & <b>fjellet</b> ')
    expect(item?.getElementsByTagName('dc:creator')[0]?.textContent).toBe('Kari "K" Nordmann')
    expect([...(item?.getElementsByTagName('category') ?? [])].map((element) => element.textContent)).toEqual([
      'Nyheter & sånt',
      'fjell',
    ])
    // `]]>` inside the HTML does not end the CDATA early.
    expect(item?.getElementsByTagName('content:encoded')[0]?.textContent).toBe(
      '<p>Tekst med ]]> inni og <a href="https://x.example/">lenke</a></p>',
    )
    expect(xml).not.toContain('\u0007')
  })

  it('leaves out content:encoded for an item without text (a protected post, or excerpts only)', () => {
    const doc = parseXml(rssXml(feedOf([{ ...ITEM, excerpt: '' }]), new Map()))
    expectRss2(doc)
    expect(doc.getElementsByTagName('content:encoded')).toHaveLength(0)
  })

  it('writes RFC 822 dates', () => {
    expect(rfc822('2026-10-27T10:00:00.000Z')).toBe('Tue, 27 Oct 2026 10:00:00 GMT')
  })
})

describe('the text of a post', () => {
  it('is the core views with addresses on the origin', async () => {
    const html = await feedHtml(
      JSON.parse(
        JSON.stringify([
          createBlock('core/paragraph', {
            content: [{ type: 'text', text: 'Les', marks: [{ type: 'link', attrs: { href: '/om/' } }] }],
          }),
        ]),
      ) as Record<string, unknown>[],
      [],
      ORIGIN,
    )
    expect(html).toContain(`href="${ORIGIN}/om/"`)
  })

  it('makes site paths absolute and leaves other hosts alone', () => {
    expect(
      absoluteUrls(
        '<img src="/uploads/a.webp" srcset="/uploads/a-300.webp 300w, //cdn.example/b.webp 600w"><a href="//x.example/">',
        ORIGIN,
      ),
    ).toBe(
      `<img src="${ORIGIN}/uploads/a.webp" srcset="${ORIGIN}/uploads/a-300.webp 300w, //cdn.example/b.webp 600w"><a href="//x.example/">`,
    )
  })
})

describe('the sitemap', () => {
  it('writes the index and a file as sitemaps.org 0.9', () => {
    const index = parseXml(
      sitemapIndexXml({
        sitemaps: [{ kind: 'posts', page: 1, loc: `${ORIGIN}/sitemap-posts-1.xml` }],
        cacheTags: [],
      }),
    )
    expect(index.documentElement.tagName).toBe('sitemapindex')
    expect(index.documentElement.getAttribute('xmlns')).toBe('http://www.sitemaps.org/schemas/sitemap/0.9')
    expect(index.getElementsByTagName('loc')[0]?.textContent).toBe(`${ORIGIN}/sitemap-posts-1.xml`)

    const file = parseXml(
      sitemapXml({
        urls: [
          { loc: `${ORIGIN}/a-&-b/`, lastmod: '2026-10-27T10:00:00.000Z' },
          { loc: `${ORIGIN}/`, lastmod: null },
        ],
        cacheTags: [],
      }),
    )
    expect(file.documentElement.tagName).toBe('urlset')
    expect([...file.getElementsByTagName('loc')].map((element) => element.textContent)).toEqual([
      `${ORIGIN}/a-&-b/`,
      `${ORIGIN}/`,
    ])
    expect(file.getElementsByTagName('lastmod')).toHaveLength(1)
  })
})

describe('robots.txt', () => {
  it('keeps crawlers out of the admin and names the sitemap when the site may be indexed', () => {
    expect(robotsTxt({ searchEngineVisible: true, origin: `${ORIGIN}/` })).toBe(
      `User-agent: *\nDisallow: /admin/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    )
  })

  it('shuts everything when it may not, as WordPress does', () => {
    expect(robotsTxt({ searchEngineVisible: false, origin: ORIGIN })).toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('feedTarget', () => {
  it('reads the feed addresses, and sends /feed to /feed/', () => {
    expect(feedTarget('/feed/')).toEqual({ kind: 'feed', prefix: '/' })
    expect(feedTarget('/category/nyheter/lokalt/feed/')).toEqual({ kind: 'feed', prefix: '/category/nyheter/lokalt/' })
    expect(feedTarget('/feed')).toEqual({ kind: 'redirect', location: '/feed/' })
    expect(feedTarget('/tag/fjell/feed')).toEqual({ kind: 'redirect', location: '/tag/fjell/feed/' })
    expect(feedTarget('/hei/')).toEqual({ kind: 'none' })
  })

  it('never sends a path that names another host anywhere', () => {
    for (const path of [
      '//evil.example/feed',
      '//evil.example/feed/',
      '/\\evil.example/feed',
      `/${'a/'.repeat(1001)}feed/`,
    ]) {
      expect(feedTarget(path), path).toEqual({ kind: 'not-found' })
    }
  })
})
