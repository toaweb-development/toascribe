// RSS, the sitemap and robots.txt (M1.6, K-222, K-223), before the pages: `/feed/` and `<archive>/feed/` (the archive's address
// as the api resolves it, so the category and tag bases and a category's parents follow the permalink settings), `/sitemap.xml`
// and its files, and `/robots.txt`. The data comes through the cache by tag, as a page's does; a change to a post, a term or a
// setting shows on the next request. Nothing is rendered with a nonce, so the documents carry none.
import {
  isSiteLocation,
  PublicFeedResponse,
  PublicSettings,
  PublicSitemapIndex,
  PublicSitemapPage,
  SitemapKind,
} from '@toascribe/shared'
import type { H3Event } from 'h3'

import { feedHtml, robotsTxt, rssXml, sitemapIndexXml, sitemapXml } from '../../lib/feeds'

const FEED = /^(\/(?:[^?#]*\/)?)feed\/?$/
const SITEMAP_FILE = /^\/sitemap-([a-z]+)-([1-9]\d{0,5})\.xml$/
/** The api's limits: the highest sitemap page, and the longest feed address. */
const MAX_SITEMAP_PAGE = 100_000
const MAX_FEED_PREFIX = 2000

function answer(event: H3Event, type: string, body: string): string {
  setResponseHeader(event, 'content-type', `${type}; charset=utf-8`)
  // The same for everyone and without a nonce, but fresh on every look: the cache by tag is on the server.
  setResponseHeader(event, 'cache-control', 'no-cache')
  return body
}

function notFound(event: H3Event): string {
  setResponseStatus(event, 404)
  return answer(event, 'text/plain', 'Not Found\n')
}

/** An api answer, or undefined for its 404 (any other failure is thrown: a 502). */
async function read(event: H3Event, path: string): Promise<unknown> {
  try {
    return await cachedFromPublicApi(event, path)
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 404) return undefined
    throw error
  }
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const { pathname } = getRequestURL(event)

  if (pathname === '/robots.txt') {
    const settings = PublicSettings.parse(await cachedFromPublicApi(event, '/settings'))
    return answer(event, 'text/plain', robotsTxt(settings))
  }

  if (pathname === '/sitemap.xml') {
    const found = await read(event, '/sitemap')
    return found === undefined
      ? notFound(event)
      : answer(event, 'application/xml', sitemapIndexXml(PublicSitemapIndex.parse(found)))
  }
  const file = SITEMAP_FILE.exec(pathname)
  if (file !== null) {
    const kind = SitemapKind.safeParse(file[1])
    if (!kind.success || Number(file[2]) > MAX_SITEMAP_PAGE) return notFound(event)
    const found = await read(event, `/sitemap/${kind.data}/${String(Number(file[2]))}`)
    return found === undefined
      ? notFound(event)
      : answer(event, 'application/xml', sitemapXml(PublicSitemapPage.parse(found)))
  }

  const feed = FEED.exec(pathname)
  if (feed === null) return
  // A path that is not plainly one on this site (`//host/feed`, which `/.//host/feed` becomes once its dot segments are gone, or a
  // backslash) has no feed, and is never sent anywhere.
  if (!isSiteLocation(`${pathname}/`)) return notFound(event)
  // `/feed` and `<archive>/feed` without the closing slash go to the address with it, as WordPress' do.
  if (!pathname.endsWith('/')) return sendRedirect(event, `${pathname}/`, 301)
  const prefix = feed[1] ?? '/'
  if (prefix.length > MAX_FEED_PREFIX) return notFound(event)
  const found = await read(event, `/feed?path=${encodeURIComponent(prefix)}`)
  if (found === undefined) return notFound(event)
  const parsed = PublicFeedResponse.parse(found)
  if (parsed.kind === 'redirect') {
    // A path on this site only (the api builds it from its own addresses).
    return isSiteLocation(parsed.location) ? sendRedirect(event, parsed.location, 301) : notFound(event)
  }
  const html = new Map<number, string>()
  await Promise.all(
    parsed.items.map(async (item, index) => {
      if (item.blocks !== null) html.set(index, await feedHtml(item.blocks, item.media, parsed.origin))
    }),
  )
  return answer(event, 'application/rss+xml', rssXml(parsed, html))
})
