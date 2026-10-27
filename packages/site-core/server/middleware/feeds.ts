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

import { feedHtml, feedTarget, robotsTxt, rssXml, sitemapIndexXml, sitemapXml } from '../../lib/feeds'

const SITEMAP_FILE = /^\/sitemap-([a-z]+)-([1-9]\d{0,5})\.xml$/
/** The api's highest sitemap page. */
const MAX_SITEMAP_PAGE = 100_000

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

  const target = feedTarget(pathname)
  if (target.kind === 'none') return
  if (target.kind === 'not-found') return notFound(event)
  if (target.kind === 'redirect') return sendRedirect(event, target.location, 301)
  const prefix = target.prefix
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
