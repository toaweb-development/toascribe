import { z } from 'zod'

import { ContentMediaRef, ContentTypeKey } from './content.ts'
import { ContentSeo } from './documents.ts'

// The public reading API of the theme SDK (M1.4; PLAN «Offentlig lesing (tema-SDK)», K-140, K-143, K-220): /api/v1/public/*, with
// no sign-in, and only content that is published and public. A password-protected item is named but its text is held back until the
// visitor gives its password (the cookie of POST /public/password); a private, draft, pending, scheduled or trashed item does not
// exist here. Every answer carries `cacheTags`: the site keeps the answer under them and drops it when a change touches one
// (GET /public/cache/changes).

const isoDate = z.iso.datetime({ offset: true })

/** The tags of a cached answer: `content:<id>`, `list:<type>`, `term:<id>`, `media:<id>`, `settings`. */
export const CacheTags = z.array(z.string().regex(/^[a-z_]+:[A-Za-z0-9_-]+$|^settings$/))
export type CacheTags = z.infer<typeof CacheTags>

export const PublicTerm = z.object({ id: z.uuid(), name: z.string(), slug: z.string(), path: z.string() })
export type PublicTerm = z.infer<typeof PublicTerm>

export const PublicAuthor = z.object({ id: z.uuid(), displayName: z.string(), nicename: z.string(), path: z.string() })
export type PublicAuthor = z.infer<typeof PublicAuthor>

/** One item in a list (an archive, the home page, a search, a Query Loop). */
export const PublicSummary = z.object({
  id: z.uuid(),
  shortId: z.int().min(1),
  type: ContentTypeKey,
  title: z.string(),
  slug: z.string(),
  /** The address on the site, a path: `/hei-verden/`, `/om-oss/team/`. */
  path: z.string(),
  publishedAt: isoDate,
  modifiedAt: isoDate,
  /** The written excerpt, or the first words of the text; empty for a protected item. */
  excerpt: z.string(),
  /** The blocks before «Les mer» (K-107) when the item has one, for an archive to show; null otherwise, and for a protected item. */
  teaser: z.array(z.record(z.string(), z.unknown())).nullable(),
  /** The text of the «Les mer» link (the block's own, or null for the theme's), when there is a teaser. */
  moreText: z.string().nullable(),
  authors: z.array(PublicAuthor),
  categories: z.array(PublicTerm),
  tags: z.array(PublicTerm),
  featuredImage: ContentMediaRef.nullable(),
  sticky: z.boolean(),
  /** Password-protected (K-067): `locked` while the visitor has not given the password. */
  protected: z.boolean(),
  locked: z.boolean(),
})
export type PublicSummary = z.infer<typeof PublicSummary>

/** A whole item, as a single post or a page shows it. */
export const PublicContent = PublicSummary.extend({
  /** The blocks, checked against their block.json; empty while the item is locked. */
  blocks: z.array(z.record(z.string(), z.unknown())),
  /** The media the blocks, the featured image and the sharing image use (public files only). */
  media: z.array(ContentMediaRef),
  seo: ContentSeo,
  /** A page's published parents, from the top (breadcrumbs, M1.6); a parent that is not published is left out. */
  ancestors: z.array(z.object({ title: z.string(), path: z.string() })),
  template: z.string().nullable(),
  parentId: z.uuid().nullable(),
  commentStatus: z.enum(['open', 'closed']),
  /** Which page of an item split by page breaks (K-227) is asked for, from 1, and how many there are. */
  page: z.int().min(1),
  pages: z.int().min(1),
})
export type PublicContent = z.infer<typeof PublicContent>

export const PublicList = z.object({
  items: z.array(PublicSummary),
  total: z.int().min(0),
  page: z.int().min(1),
  pages: z.int().min(0),
  perPage: z.int().min(1),
})
export type PublicList = z.infer<typeof PublicList>

/** What an archive is about (K-220): its kind and what the heading names. */
export const PublicArchive = z.discriminatedUnion('type', [
  z.object({ type: z.literal('home') }),
  z.object({ type: z.literal('category'), term: PublicTerm }),
  z.object({ type: z.literal('tag'), term: PublicTerm }),
  z.object({ type: z.literal('author'), author: PublicAuthor }),
  z.object({
    type: z.literal('date'),
    year: z.int(),
    month: z.int().min(1).max(12).nullable(),
    day: z.int().min(1).max(31).nullable(),
  }),
  z.object({ type: z.literal('search'), query: z.string() }),
])
export type PublicArchive = z.infer<typeof PublicArchive>

/**
 * What an address is (GET /public/resolve?path=), after WordPress' template hierarchy (K-140): `templates` lists the templates to try,
 * most specific first and `index` last; the site takes the first its theme has. `status` is the HTTP status the page answers with.
 */
/** A path on the site to send a visitor to: `/…`, never `//host` or `/\\host`, no control character (security §4). */
export function isSiteLocation(location: string): boolean {
  return /^\/(?![/\\])[^\p{Cc}\\]*$/u.test(location)
}

export const ResolveResponse = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('redirect'),
    status: z.union([z.literal(301), z.literal(302)]),
    /** A path on the site only: `/…`, never `//host` or `/\host` (security §4), and no control character. */
    location: z.string().refine(isSiteLocation, { message: 'a path on the site' }),
    cacheTags: CacheTags,
  }),
  z.object({
    kind: z.enum(['single', 'page', 'front-page']),
    status: z.literal(200),
    templates: z.array(z.string()).min(1),
    content: PublicContent,
    cacheTags: CacheTags,
  }),
  z.object({
    kind: z.enum(['home', 'archive', 'search']),
    status: z.literal(200),
    templates: z.array(z.string()).min(1),
    archive: PublicArchive,
    list: PublicList,
    cacheTags: CacheTags,
  }),
  z.object({
    kind: z.literal('404'),
    status: z.literal(404),
    templates: z.array(z.string()).min(1),
    cacheTags: CacheTags,
  }),
])
export type ResolveResponse = z.infer<typeof ResolveResponse>

export const ResolveQuery = z.object({
  /** The path and query of the address on the site: `/hei-verden/`, `/category/nyheter/page/2/`, `/?s=fjell`, `/?p=12`. */
  path: z.string().min(1).max(2000),
})

/** GET /public/query (K-085, the theme SDK's useQuery): published posts or pages by filter. */
export const PublicQuery = z.object({
  type: ContentTypeKey.default('post'),
  /** A category's or a tag's slug. */
  category: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  /** An author's nicename. */
  author: z.string().max(200).optional(),
  year: z.coerce.number().int().min(1970).max(9999).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  day: z.coerce.number().int().min(1).max(31).optional(),
  search: z.string().trim().max(200).optional(),
  orderby: z.enum(['date', 'title', 'menu_order']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  per_page: z.coerce.number().int().min(1).max(50).optional(),
  /** Leaves the sticky posts out (a Query Loop's choice). */
  exclude_sticky: z.enum(['true', 'false']).optional(),
  /** Puts the sticky posts first, as the home page does. */
  sticky_first: z.enum(['true', 'false']).optional(),
})
export type PublicQuery = z.infer<typeof PublicQuery>
export type PublicQueryInput = z.input<typeof PublicQuery>

export const PublicListResponse = PublicList.extend({ cacheTags: CacheTags })
export type PublicListResponse = z.infer<typeof PublicListResponse>

/** GET /public/settings (the SDK's useSettings): what a theme shows from Settings → General and → Reading. */
export const PublicSettings = z.object({
  title: z.string(),
  tagline: z.string(),
  locale: z.string(),
  timezone: z.string(),
  postsPerPage: z.int().min(1),
  /** «Forsiden viser» (K-226): the latest posts, or a static page. */
  showOnFront: z.enum(['posts', 'page']),
  /** The address of the page of posts when the front page is static; null otherwise. */
  postsPagePath: z.string().nullable(),
  /** «Søkemotorsynlighet» (K-194): false asks search engines not to index the site (`noindex`, and robots.txt in M1.6). */
  searchEngineVisible: z.boolean(),
  /** The address of the published privacy policy page (K-198, K-199); null without one. */
  privacyPolicyPath: z.string().nullable(),
  /** PUBLIC_ORIGIN (M1.6): absolute addresses (canonical, Open Graph, robots.txt) are built on it, never on a request's Host. */
  origin: z.url({ protocol: /^https?$/ }),
  /** «Deling og søkemotorer» (M1.6, K-224): the sharing image of last resort, and who publishes the site (null: nobody named). */
  seo: z.object({
    defaultImage: ContentMediaRef.nullable(),
    publisher: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('organization'), name: z.string(), logo: ContentMediaRef.nullable() }),
        z.object({ type: z.literal('person'), name: z.string(), path: z.string() }),
      ])
      .nullable(),
  }),
  cacheTags: CacheTags,
})
export type PublicSettings = z.infer<typeof PublicSettings>

/** POST /public/password (K-067): the password of a protected item; sets the cookie that opens it for ten days. */
export const PublicPasswordRequest = z.strictObject({
  contentId: z.uuid(),
  password: z.string().min(1).max(255),
})
export type PublicPasswordRequest = z.infer<typeof PublicPasswordRequest>

/**
 * A place in the log of cache changes: the oldest transaction still running when the site looked, and when (ms since 1970). The site
 * sends it back as `since`; it is opaque to the site.
 */
export const CacheCursor = z.string().regex(/^\d{1,19}\.\d{1,15}$/)

/** GET /public/cache/changes?since= : the tags changed since then, or `all` when it is too long ago (or the first look). */
export const CacheChanges = z.object({
  /** The next `since`. */
  cursor: CacheCursor,
  all: z.boolean(),
  tags: z.array(z.string()),
})
export type CacheChanges = z.infer<typeof CacheChanges>

/** POST /content/{id}/preview-link (K-071): a signed address that shows the item as it is stored, for a while. */
export const PreviewLinkResponse = z.object({
  /** A path on the site: `/?preview=<token>`. */
  path: z.string(),
  expiresAt: isoDate,
})
export type PreviewLinkResponse = z.infer<typeof PreviewLinkResponse>

/** GET /public/preview (K-071): the token of a preview link, and the page of an item split by page breaks. */
export const PreviewQuery = z.object({
  token: z.string().min(1).max(600),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

/** GET /public/cache/changes: the cursor of the site's last look; without it, everything has changed. */
export const CacheChangesQuery = z.object({ since: CacheCursor.optional() })

/** How long a preview link works. */
export const PREVIEW_LINK_MINUTES = 30
/** How long the cookie of a post's password lasts (WordPress: ten days). */
export const POST_PASSWORD_COOKIE_DAYS = 10
/** The names of the cookies the site must never cache a page for (with the `__Host-` prefix the browser sends). */
export const SESSION_COOKIE_NAME = '__Host-toa_session'
export const POST_PASSWORD_COOKIE_NAME = '__Host-toa_postpass'
