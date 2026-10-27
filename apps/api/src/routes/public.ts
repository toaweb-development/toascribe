import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiError,
  CacheChanges,
  CacheChangesQuery,
  ContentIdParams,
  POST_PASSWORD_COOKIE_DAYS,
  PreviewLinkResponse,
  PreviewQuery,
  PublicListResponse,
  PublicPasswordRequest,
  PublicQuery,
  PublicSettings,
  PublicFeedQuery,
  PublicOEmbedQuery,
  PublicOEmbedResponse,
  PublicSitemapIndex,
  PublicSitemapPage,
  SitemapKind,
  PublicFeedResponse,
  ResolveQuery,
  ResolveResponse,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import { readPostPassCookie, setPostPassCookie } from '../lib/cookies.ts'
import type { AppEnv } from '../lib/env.ts'
import { AppError } from '../lib/errors.ts'
import { publicAccess, requireAnyCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// The public reading API (M1.4): what the site and its theme read. Open to anyone, and it only ever shows what is published and
// public; a password-protected item's text comes only with its password cookie, and a preview only with a signed link. Every answer
// carries the cache tags that a change clears on the site (`cacheTags`). The answers are `Cache-Control: no-store` (app.ts, errors included):
// the site keeps its own cache by tag and asks /public/cache/changes what to drop.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})
const json = <T>(schema: T, description: string) => ({ content: { 'application/json': { schema } }, description })

const TAG = 'public'
const PUBLIC = publicAccess()

const settingsRoute = defineRoute({
  method: 'get',
  path: '/public/settings',
  tags: [TAG],
  summary: 'The settings a theme shows',
  description:
    'The site title, the tagline, the language and time zone, the reading settings (K-226) and the posts page.',
  policy: PUBLIC,
  responses: { 200: json(PublicSettings, 'The settings') },
})

const resolveRoute = defineRoute({
  method: 'get',
  path: '/public/resolve',
  tags: [TAG],
  summary: 'What an address on the site is',
  description:
    "WordPress' template hierarchy: the front page, the posts page, a page by its path, a post by its slug (`/<slug>/2/` for its " +
    'second page), the category, tag, author and date archives (`/page/2/` for the next page), the search (`?s=`), `?p=` as a ' +
    'redirect (K-065), and 404. `templates` lists the templates to try, most specific first. A 404 is an answer, not an error. ' +
    'A protected item without its password cookie comes with `locked` and no text.',
  policy: PUBLIC,
  request: { query: ResolveQuery },
  responses: { 200: json(ResolveResponse, 'What the address is'), 400: errorResponse('Invalid query') },
})

const feedRoute = defineRoute({
  method: 'get',
  path: '/public/feed',
  tags: [TAG],
  summary: 'The RSS feed under an address (K-222)',
  description:
    "For the site's `/feed/`, `<archive>/feed/` routes: the latest posts (`path=/`), or a category's (with its parents), a tag's, " +
    "an author's or a date archive's, as many as «Elementer i RSS» and with the text or the excerpt as «Lesing» says. Published, " +
    'public posts only; a password-protected post has its title and link only. Addresses are absolute (PUBLIC_ORIGIN). An old ' +
    'archive address answers where its feed is now; an address without a feed is 404.',
  policy: PUBLIC,
  request: { query: PublicFeedQuery },
  responses: {
    200: json(PublicFeedResponse, 'The feed, or where it moved'),
    400: errorResponse('Invalid query'),
    404: errorResponse('No feed at that address'),
  },
})

const oembedRoute = defineRoute({
  method: 'get',
  path: '/public/oembed',
  tags: [TAG],
  summary: 'The site as an oEmbed provider (M1.6, K-225)',
  description:
    "For the site's `/oembed?url=`: a `link` answer (oEmbed 1.0) for this site's own published, public content without a " +
    'password; 404 for any other address (another host, a draft, a private or protected item, an archive). JSON only: ' +
    '`format=xml` is 501, as oEmbed asks.',
  policy: PUBLIC,
  request: { query: PublicOEmbedQuery },
  responses: {
    200: json(PublicOEmbedResponse, 'The answer'),
    400: errorResponse('Invalid query'),
    404: errorResponse('No content of this site at that address'),
    501: errorResponse('Only JSON'),
  },
})

const sitemapIndexRoute = defineRoute({
  method: 'get',
  path: '/public/sitemap',
  tags: [TAG],
  summary: "The sitemap's index (K-223)",
  description:
    "For the site's `/sitemap.xml`: the files of posts, pages, categories, tags and authors, at most 2000 addresses each. 404 " +
    'when «Be søkemotorer om ikke å indeksere» is on.',
  policy: PUBLIC,
  responses: { 200: json(PublicSitemapIndex, 'The files'), 404: errorResponse('The site asks not to be indexed') },
})

const sitemapPageRoute = defineRoute({
  method: 'get',
  path: '/public/sitemap/{kind}/{page}',
  tags: [TAG],
  summary: 'One file of the sitemap',
  description:
    'Published, public items without a password and without «noindex», and the categories, tags and authors with such a post. ' +
    'Addresses are absolute (PUBLIC_ORIGIN).',
  policy: PUBLIC,
  request: { params: z.object({ kind: SitemapKind, page: z.coerce.number().int().min(1).max(100_000) }) },
  responses: {
    200: json(PublicSitemapPage, 'The addresses'),
    400: errorResponse('Invalid kind or page'),
    404: errorResponse('No such file, or the site asks not to be indexed'),
  },
})

const queryRoute = defineRoute({
  method: 'get',
  path: '/public/query',
  tags: [TAG],
  summary: 'Published posts or pages by filter',
  description:
    'For the Query Loop block and `useQuery` (K-085): by type, category, tag, author, date and search, in an order.',
  policy: PUBLIC,
  request: { query: PublicQuery },
  responses: { 200: json(PublicListResponse, 'One page of items'), 400: errorResponse('Invalid query') },
})

const unlockRoute = defineRoute({
  method: 'post',
  path: '/public/unlock',
  tags: [TAG],
  summary: 'Open a protected item with its password',
  description:
    `Sets the post password cookie (HttpOnly, ${String(POST_PASSWORD_COOKIE_DAYS)} days, K-067). It opens the item whose ` +
    'password it was, and the last password typed replaces it, as in WordPress. Guesses are limited per address and per item. ' +
    'A same-origin request with an application/json body.',
  policy: PUBLIC,
  request: { body: { required: true, content: { 'application/json': { schema: PublicPasswordRequest } } } },
  responses: {
    204: { description: 'The cookie is set' },
    400: errorResponse('`wrong_password`, or an invalid request'),
    403: errorResponse('Not a same-origin request'),
    429: errorResponse('Too many guesses: wait (Retry-After)'),
  },
})

const previewRoute = defineRoute({
  method: 'get',
  path: '/public/preview',
  tags: [TAG],
  summary: 'The item a preview link shows',
  description:
    'The item as it is stored, draft and protected items included (K-071), while the link has not expired, the session that made ' +
    'it is live and its account may still edit the item. 404 for a link that is not good, whatever the reason.',
  policy: PUBLIC,
  request: { query: PreviewQuery },
  responses: {
    200: json(ResolveResponse, 'The item'),
    400: errorResponse('Invalid query'),
    404: errorResponse('No such link'),
  },
})

const changesRoute = defineRoute({
  method: 'get',
  path: '/public/cache/changes',
  tags: [TAG],
  summary: 'The cache tags changed since a time',
  description:
    'The site drops what it cached under these tags; `all` means everything (the first look, or one too long ago).',
  policy: PUBLIC,
  request: { query: CacheChangesQuery },
  responses: { 200: json(CacheChanges, 'The changed tags'), 400: errorResponse('Invalid query') },
})

const previewLinkRoute = defineRoute({
  method: 'post',
  path: '/content/{id}/preview-link',
  tags: ['content'],
  summary: 'A preview link for an item',
  description:
    'A signed address on the site that shows the item as it is stored for 30 minutes, to anyone who has it, until the session that ' +
    'made it ends (K-071). Needs edit rights to the item, the X-CSRF-Token header of the session and a same-origin request.',
  policy: requireAnyCapability('edit_posts', 'edit_pages'),
  request: { params: ContentIdParams },
  responses: {
    200: json(PreviewLinkResponse, 'The link'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    404: errorResponse('No such item, or no right to edit it'),
  },
})

export function createPublicApp(services: Services): OpenAPIHono<AppEnv> {
  const visitor = (c: Parameters<typeof readPostPassCookie>[0]) => ({ postPass: readPostPassCookie(c) })
  return new OpenAPIHono<AppEnv>()
    .openapi(settingsRoute, async (c) => {
      return c.json(await services.public.settings(), 200)
    })
    .openapi(oembedRoute, async (c) => {
      const query = c.req.valid('query')
      if (query.format === 'xml') throw new AppError(501, 'not_implemented', 'JSON only')
      return c.json(await services.public.oembed(query.url), 200)
    })
    .openapi(sitemapIndexRoute, async (c) => c.json(await services.public.sitemapIndex(), 200))
    .openapi(sitemapPageRoute, async (c) => {
      const { kind, page } = c.req.valid('param')
      return c.json(await services.public.sitemapPage(kind, page), 200)
    })
    .openapi(feedRoute, async (c) => c.json(await services.public.feed(c.req.valid('query').path), 200))
    .openapi(resolveRoute, async (c) => {
      return c.json(await services.public.resolve(c.req.valid('query').path, visitor(c)), 200)
    })
    .openapi(queryRoute, async (c) => {
      return c.json(await services.public.query(c.req.valid('query'), visitor(c)), 200)
    })
    .openapi(unlockRoute, async (c) => {
      const { contentId, password } = c.req.valid('json')
      const cookie = await services.public.unlock(contentId, password, getClientIp(c))
      if (cookie === undefined) throw new AppError(400, 'wrong_password', 'The password is wrong')
      setPostPassCookie(c, cookie, POST_PASSWORD_COOKIE_DAYS * 24 * 60 * 60)
      return c.body(null, 204)
    })
    .openapi(previewRoute, async (c) => {
      const { token, page } = c.req.valid('query')
      return c.json(await services.public.preview(token, page), 200)
    })
    .openapi(changesRoute, async (c) => {
      return c.json(await services.public.changes(c.req.valid('query').since), 200)
    })
    .openapi(previewLinkRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.public.previewLink(auth, c.req.valid('param').id), 200)
    })
}
