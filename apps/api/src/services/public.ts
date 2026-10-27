// The public reading API (M1.4; PLAN «Offentlig lesing (tema-SDK)», K-140, K-220, K-226, K-227, K-065, K-067, K-071): what an address on
// the site is, after WordPress' template hierarchy, lists for archives and the Query Loop, the settings a theme shows, the password
// of a protected item, the preview link, and the cache tags a change touched. Only content that is published and public is read
// (repositories/public.ts); a password-protected item is named, but its text, its excerpt and its blocks stay out until the visitor
// has the item's password cookie. A preview link shows any item, for a while, to the account and the session that made it.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { dummyPasswordHash, verifyPassword } from '@toascribe/auth'
import type { Block } from '@toascribe/blocks'
import { MORE, NEXTPAGE, documentMediaRefs, documentText, validateDocument } from '@toascribe/blocks'
import type { Database } from '@toascribe/db'
import { ContentSeo, CoreSettings, PREVIEW_LINK_MINUTES, textSearchConfig } from '@toascribe/shared'
import type {
  CacheChanges,
  ContentMediaRef,
  PreviewLinkResponse,
  PublicArchive,
  PublicAuthor,
  PublicContent,
  PublicList,
  PublicListResponse,
  PublicQuery,
  PublicSettings,
  PublicSummary,
  PublicTerm,
  ResolveResponse,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { canEdit } from '../lib/content-access.ts'
import { NotFoundError } from '../lib/errors.ts'
import { authorsOf, capabilitiesOf, findContent } from '../repositories/content.ts'
import type { Executor } from '../repositories/executor.ts'
import {
  findAnyById,
  findAuthorByNicename,
  findPublishedById,
  findPublishedByShortId,
  findPublishedPages,
  findPublishedPost,
  findTermBySlug,
  liveSessionAccount,
  listPublic,
  pagePaths,
  publicAuthorsOf,
  oldestRunningXid,
  tagsChangedSince,
  termWithDescendants,
} from '../repositories/public.ts'
import type { PublicListFilter, PublicRow } from '../repositories/public.ts'
import { readSettings } from '../repositories/settings.ts'
import { termsOfContent } from '../repositories/terms.ts'
import type { MediaService } from './media.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed } from './support.ts'

const SETTINGS = CoreSettings.pick({
  blogname: true,
  blogdescription: true,
  locale: true,
  timezone_string: true,
  gmt_offset: true,
  posts_per_page: true,
  show_on_front: true,
  page_on_front: true,
  page_for_posts: true,
})
type Settings = { readonly [K in keyof typeof SETTINGS.shape]: (typeof SETTINGS.shape)[K]['_output'] }

/** WordPress' excerpt length in words, and what ends an excerpt made from the text. */
const EXCERPT_WORDS = 55
const EXCERPT_MORE = ' …'
/** How long the site may go between looks at the cache changes before it must drop everything (the worker keeps a day). */
const CHANGES_KEPT_MS = 23 * 60 * 60 * 1000

/** Nobody signed in: what the media service may show to a visitor (public files only). */
const VISITOR = { id: '', capabilities: new Set<string>() } as const

/** What the visitor's request carries that changes the answer. */
export interface Visitor {
  /** The value of the post password cookie (K-067), if any. */
  readonly postPass?: string | undefined
}

export interface PublicService {
  settings(): Promise<PublicSettings>
  resolve(path: string, visitor: Visitor): Promise<ResolveResponse>
  query(query: PublicQuery, visitor: Visitor): Promise<PublicListResponse>
  /**
   * The cookie value that opens items with this password, or undefined for a wrong password or an item that is not public and
   * protected. Guesses are limited per address and per item, as logins are (429 when they must wait).
   */
  unlock(contentId: string, password: string, ip: string): Promise<string | undefined>
  /** The item a preview link shows; NotFoundError when the link is not good (any reason). */
  preview(token: string, page: number): Promise<ResolveResponse>
  previewLink(auth: SessionAuth, contentId: string): Promise<PreviewLinkResponse>
  changes(since: string | undefined): Promise<CacheChanges>
}

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

function intlTimeZone(settings: Settings): string {
  if (settings.timezone_string !== '') return settings.timezone_string
  const minutes = Math.round(Math.abs(settings.gmt_offset) * 60)
  const sign = settings.gmt_offset < 0 ? '-' : '+'
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The blocks of a stored tree that pass their block.json (anything else is not shown). */
function blocksOf(row: PublicRow): Block[] {
  const checked = validateDocument(row.blocks)
  return checked.ok ? checked.blocks : []
}

/** The blocks before the first «Les mer», and its text; undefined without one (K-107). */
function teaserOf(blocks: readonly Block[]): { teaser: Block[]; moreText: string | null } | undefined {
  const at = blocks.findIndex((block) => block.type === MORE)
  if (at === -1) return undefined
  const text = blocks[at]?.attrs['customText']
  return { teaser: blocks.slice(0, at), moreText: typeof text === 'string' && text.trim() !== '' ? text.trim() : null }
}

/** The excerpt WordPress shows: the written one, or the first 55 words of the text (before «Les mer» when there is one). */
function excerptOf(row: PublicRow, blocks: readonly Block[]): string {
  if (row.excerpt.trim() !== '') return row.excerpt.trim()
  const words = documentText(teaserOf(blocks)?.teaser ?? blocks)
    .split(/\s+/)
    .filter((word) => word !== '')
  return words.length > EXCERPT_WORDS ? `${words.slice(0, EXCERPT_WORDS).join(' ')}${EXCERPT_MORE}` : words.join(' ')
}

/** How many pages a post split by page breaks has (K-227). */
function pageCount(blocks: readonly Block[]): number {
  return blocks.filter((block) => block.type === NEXTPAGE).length + 1
}

function asJson(blocks: readonly Block[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(blocks)) as Record<string, unknown>[]
}

const termPath = (taxonomy: 'category' | 'post_tag', slug: string) =>
  `/${taxonomy === 'category' ? 'category' : 'tag'}/${encodeURIComponent(slug)}/`
const authorPath = (nicename: string) => `/author/${encodeURIComponent(nicename)}/`

export function createPublicService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly media: Pick<MediaService, 'contentRefs'>
  readonly signingKey: Uint8Array
  readonly limiter: Pick<RateLimiter, 'begin' | 'succeed'>
  readonly onInvalidSetting?: (key: string) => void
}): PublicService {
  const { db, clock, media, signingKey, limiter } = options
  const settingsOf = (executor: Executor = db) => readSettings(executor, SETTINGS, options.onInvalidSetting)

  /** The cookie value that opens items whose password has this hash: one cookie for the last password, as WordPress has. */
  const passCookieFor = (passwordHash: string) =>
    base64url(createHmac('sha256', signingKey).update(`toascribe:postpass\0${passwordHash}`).digest())

  function isUnlocked(row: PublicRow, visitor: Visitor): boolean {
    if (row.passwordHash === null) return true
    return visitor.postPass !== undefined && sameSecret(visitor.postPass, passCookieFor(row.passwordHash))
  }

  async function pathsOf(rows: readonly PublicRow[]): Promise<Map<string, { path: string; ancestors: string[] }>> {
    const pages = await pagePaths(
      db,
      rows.filter((row) => row.type === 'page').map((row) => row.id),
    )
    const found = new Map(pages)
    for (const row of rows) {
      if (row.type === 'post') found.set(row.id, { path: `/${encodeURIComponent(row.slug)}/`, ancestors: [] })
    }
    return found
  }

  /** The list items of rows, with their authors, terms, featured images and addresses. */
  async function summaries(
    rows: readonly PublicRow[],
    visitor: Visitor,
    settings: Settings,
  ): Promise<{ items: PublicSummary[]; mediaIds: string[] }> {
    const ids = rows.map((row) => row.id)
    const [authors, terms, paths] = await Promise.all([
      publicAuthorsOf(db, ids),
      termsOfContent(db, ids),
      pathsOf(rows),
    ])
    const featuredIds = [...new Set(rows.flatMap((row) => (row.featuredMediaId === null ? [] : [row.featuredMediaId])))]
    const featured = new Map(
      (featuredIds.length === 0 ? [] : await media.contentRefs(VISITOR, featuredIds)).map((ref) => [ref.id, ref]),
    )
    const items = rows.map((row): PublicSummary => {
      const unlocked = isUnlocked(row, visitor)
      const blocks = unlocked ? blocksOf(row) : []
      const teaser = unlocked ? teaserOf(blocks) : undefined
      const rowTerms = terms.get(row.id)
      return {
        id: row.id,
        shortId: row.shortId,
        type: row.type,
        title: row.title,
        slug: row.slug,
        path: frontPath(row, settings) ?? paths.get(row.id)?.path ?? `/${row.slug}/`,
        publishedAt: row.publishedAt.toISOString(),
        modifiedAt: row.modifiedAt.toISOString(),
        excerpt: unlocked ? excerptOf(row, blocks) : '',
        teaser: teaser === undefined ? null : asJson(teaser.teaser),
        moreText: teaser?.moreText ?? null,
        authors: (authors.get(row.id) ?? []).map((author): PublicAuthor => ({
          ...author,
          path: authorPath(author.nicename),
        })),
        categories: (rowTerms?.categories ?? []).map((term): PublicTerm => ({
          id: term.id,
          name: term.name,
          slug: term.slug,
          path: termPath('category', term.slug),
        })),
        tags: (rowTerms?.tags ?? []).map((term): PublicTerm => ({
          id: term.id,
          name: term.name,
          slug: term.slug,
          path: termPath('post_tag', term.slug),
        })),
        featuredImage: row.featuredMediaId === null ? null : (featured.get(row.featuredMediaId) ?? null),
        sticky: row.type === 'post' && row.sticky,
        protected: row.passwordHash !== null,
        locked: !unlocked,
      }
    })
    return { items, mediaIds: [...featured.keys()] }
  }

  /** The front page's address is `/`, whatever its slug (K-226). */
  function frontPath(row: PublicRow, settings: Settings): string | undefined {
    return settings.show_on_front === 'page' && settings.page_on_front === row.id ? '/' : undefined
  }

  async function contentOf(
    row: PublicRow,
    visitor: Visitor,
    settings: Settings,
    page: number,
  ): Promise<{ content: PublicContent; tags: string[] } | undefined> {
    const [summary] = (await summaries([row], visitor, settings)).items
    if (summary === undefined) return undefined
    const unlocked = !summary.locked
    const blocks = unlocked ? blocksOf(row) : []
    const pages = unlocked ? pageCount(blocks) : 1
    if (page > pages) return undefined
    const stored = ContentSeo.catch({}).parse(row.seo)
    // A locked item's description is about its hidden text, as its excerpt is: it stays out until the password is given.
    const seo: ContentSeo = { ...stored }
    if (!unlocked) delete seo.description
    const mediaIds = [
      ...documentMediaRefs(blocks).map((ref) => ref.mediaId),
      ...(row.featuredMediaId === null ? [] : [row.featuredMediaId]),
      ...(seo.image === undefined ? [] : [seo.image]),
    ]
    const mediaRefs: ContentMediaRef[] =
      mediaIds.length === 0 ? [] : await media.contentRefs(VISITOR, [...new Set(mediaIds)])
    const ancestors = (await pagePaths(db, row.type === 'page' ? [row.id] : [])).get(row.id)?.ancestors ?? []
    return {
      content: {
        ...summary,
        blocks: asJson(blocks),
        media: mediaRefs,
        seo,
        template: row.template,
        parentId: row.parentId,
        commentStatus: row.commentStatus,
        page,
        pages,
      },
      tags: [
        `content:${row.id}`,
        ...ancestors.map((id) => `content:${id}`),
        ...summary.categories.map((term) => `term:${term.id}`),
        ...summary.tags.map((term) => `term:${term.id}`),
        ...mediaRefs.map((ref) => `media:${ref.id}`),
        'settings',
      ],
    }
  }

  function singleTemplates(row: PublicRow, front: boolean): string[] {
    const slug = row.slug
    const chosen = row.template === null || row.template === 'default' ? [] : [row.template]
    const list =
      row.type === 'page'
        ? [...chosen, `page-${slug}`, 'page', 'singular', 'index']
        : [`single-post-${slug}`, 'single-post', 'single', 'singular', 'index']
    return front ? ['front-page', ...list] : list
  }

  async function single(
    row: PublicRow,
    visitor: Visitor,
    settings: Settings,
    page: number,
    front = false,
  ): Promise<ResolveResponse> {
    const found = await contentOf(row, visitor, settings, page)
    if (found === undefined) return notFound()
    return {
      kind: front ? 'front-page' : row.type === 'page' ? 'page' : 'single',
      status: 200,
      templates: singleTemplates(row, front),
      content: found.content,
      cacheTags: [...new Set(found.tags)],
    }
  }

  function notFound(): ResolveResponse {
    return { kind: '404', status: 404, templates: ['404', 'index'], cacheTags: ['list:post', 'list:page', 'settings'] }
  }

  async function list(
    filter: Omit<PublicListFilter, 'searchConfig' | 'timeZone'>,
    order: { orderby: 'date' | 'title' | 'menu_order'; order: 'asc' | 'desc'; stickyFirst: boolean },
    page: number,
    perPage: number,
    visitor: Visitor,
    settings: Settings,
  ): Promise<{ list: PublicList; tags: string[] }> {
    const { rows, total } = await listPublic(
      db,
      { ...filter, searchConfig: textSearchConfig(settings.locale), timeZone: intlTimeZone(settings) },
      order,
      perPage,
      (page - 1) * perPage,
    )
    const { items, mediaIds } = await summaries(rows, visitor, settings)
    const types = filter.types ?? [filter.type]
    return {
      list: { items, total, page, pages: Math.ceil(total / perPage), perPage },
      tags: [...types.map((type) => `list:${type}`), ...mediaIds.map((id) => `media:${id}`), 'settings'],
    }
  }

  async function archive(
    kind: 'home' | 'archive' | 'search',
    archiveInfo: PublicArchive,
    templates: string[],
    filter: Omit<PublicListFilter, 'searchConfig' | 'timeZone'>,
    page: number,
    visitor: Visitor,
    settings: Settings,
    extraTags: string[] = [],
  ): Promise<ResolveResponse> {
    const { list: result, tags } = await list(
      filter,
      { orderby: 'date', order: 'desc', stickyFirst: kind === 'home' && page === 1 },
      page,
      settings.posts_per_page,
      visitor,
      settings,
    )
    // Past the last page there is nothing (WordPress: 404); the first page of an empty archive is a page that says so.
    if (page > 1 && page > result.pages) return notFound()
    return { kind, status: 200, templates, archive: archiveInfo, list: result, cacheTags: [...tags, ...extraTags] }
  }

  /** The published page at a path of slugs (`/om-oss/team/`): the one whose own path is exactly that. */
  async function pageAt(segments: readonly string[]): Promise<PublicRow | undefined> {
    const last = segments.at(-1)
    if (last === undefined) return undefined
    const candidates = await findPublishedPages(db, last)
    if (candidates.length === 0) return undefined
    const paths = await pagePaths(
      db,
      candidates.map((row) => row.id),
    )
    const wanted = `/${segments.join('/')}/`
    return candidates.find((row) => paths.get(row.id)?.path === wanted)
  }

  /** The canonical address of an item (the front page's is `/`). */
  async function pathOf(row: PublicRow, settings: Settings): Promise<string> {
    return frontPath(row, settings) ?? (await pathsOf([row])).get(row.id)?.path ?? `/${row.slug}/`
  }

  function decodeSegments(pathname: string): string[] | undefined {
    try {
      return pathname
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => decodeURIComponent(segment).normalize('NFC'))
    } catch {
      return undefined
    }
  }

  /** Whether the account (active, with its roles now) may edit the item: who may preview it (K-071). Never for an item in the trash. */
  async function mayEdit(accountId: string, contentId: string): Promise<boolean> {
    const row = await findContent(db, contentId)
    if (row === undefined || row.status === 'trash') return false
    const [authors, capabilities] = await Promise.all([authorsOf(db, [row.id]), capabilitiesOf(db, [accountId])])
    const held = capabilities.get(accountId)
    if (held === undefined) return false
    return canEdit(
      { id: accountId, capabilities: held },
      {
        type: row.type,
        status: row.status,
        statusBeforeTrash: row.statusBeforeTrash,
        authorIds: (authors.get(row.id) ?? []).map((author) => author.id),
      },
    )
  }

  const service: PublicService = {
    async settings() {
      const settings = await settingsOf()
      const postsPage =
        settings.show_on_front === 'page' && settings.page_for_posts !== null
          ? await findPublishedById(db, settings.page_for_posts)
          : undefined
      return {
        title: settings.blogname,
        tagline: settings.blogdescription,
        locale: settings.locale,
        timezone: intlTimeZone(settings),
        postsPerPage: settings.posts_per_page,
        showOnFront: settings.show_on_front,
        postsPagePath: postsPage === undefined ? null : await pathOf(postsPage, settings),
        cacheTags: ['settings', ...(postsPage === undefined ? [] : [`content:${postsPage.id}`])],
      }
    },

    async resolve(path, visitor) {
      const settings = await settingsOf()
      const url = new URL(path.startsWith('/') ? path : `/${path}`, 'http://site.invalid')
      let segments = decodeSegments(url.pathname)
      if (segments === undefined) return notFound()

      // `/?p=12` (K-065): to the item's address, published items only.
      const shortId = url.searchParams.get('p')
      if (shortId !== null) {
        const row = /^\d{1,10}$/.test(shortId) ? await findPublishedByShortId(db, Number(shortId)) : undefined
        return row === undefined
          ? notFound()
          : { kind: 'redirect', status: 301, location: await pathOf(row, settings), cacheTags: [`content:${row.id}`] }
      }

      // `/page/2/` at the end of an archive's address, or `/2/` at the end of an item's (K-227).
      let page = 1
      const pagedAt = segments.length - 2
      if (segments.length >= 2 && segments[pagedAt] === 'page' && /^\d{1,5}$/.test(segments.at(-1) ?? '')) {
        page = Number(segments.at(-1))
        segments = segments.slice(0, pagedAt)
      }
      if (page < 1) return notFound()

      const search = url.searchParams.get('s')
      if (search !== null) {
        const query = search.trim().slice(0, 200)
        return archive(
          'search',
          { type: 'search', query },
          ['search', 'index'],
          { type: 'post', types: ['post', 'page'], search: query },
          page,
          visitor,
          settings,
        )
      }

      if (segments.length === 0) {
        const front =
          settings.show_on_front === 'page' && settings.page_on_front !== null
            ? await findPublishedById(db, settings.page_on_front)
            : undefined
        if (front !== undefined && page === 1) return single(front, visitor, settings, 1, true)
        return archive(
          'home',
          { type: 'home' },
          ['front-page', 'home', 'index'],
          { type: 'post' },
          page,
          visitor,
          settings,
        )
      }

      const [head, second, third, fourth] = segments
      if (head === 'category' && segments.length >= 2) {
        const term = await findTermBySlug(db, 'category', segments.at(-1) ?? '')
        if (term === undefined) return notFound()
        return archive(
          'archive',
          { type: 'category', term: { ...term, path: termPath('category', term.slug) } },
          [`category-${term.slug}`, 'category', 'archive', 'index'],
          { type: 'post', termIds: await termWithDescendants(db, term.id) },
          page,
          visitor,
          settings,
          [`term:${term.id}`],
        )
      }
      if (head === 'tag' && segments.length === 2 && second !== undefined) {
        const term = await findTermBySlug(db, 'post_tag', second)
        if (term === undefined) return notFound()
        return archive(
          'archive',
          { type: 'tag', term: { ...term, path: termPath('post_tag', term.slug) } },
          [`tag-${term.slug}`, 'tag', 'archive', 'index'],
          { type: 'post', termIds: [term.id] },
          page,
          visitor,
          settings,
          [`term:${term.id}`],
        )
      }
      if (head === 'author' && segments.length === 2 && second !== undefined) {
        const author = await findAuthorByNicename(db, second)
        if (author === undefined) return notFound()
        return archive(
          'archive',
          { type: 'author', author: { ...author, path: authorPath(author.nicename) } },
          [`author-${author.nicename}`, 'author', 'archive', 'index'],
          { type: 'post', authorId: author.id },
          page,
          visitor,
          settings,
        )
      }
      // Date archives: /2026/, /2026/10/, /2026/10/27/.
      if (head !== undefined && /^\d{4}$/.test(head) && segments.length <= 3) {
        const year = Number(head)
        const month = second === undefined ? undefined : /^\d{2}$/.test(second) ? Number(second) : Number.NaN
        const day = third === undefined ? undefined : /^\d{2}$/.test(third) ? Number(third) : Number.NaN
        const valid =
          fourth === undefined &&
          (month === undefined || (month >= 1 && month <= 12)) &&
          (day === undefined || (day >= 1 && day <= 31))
        if (valid) {
          return archive(
            'archive',
            { type: 'date', year, month: month ?? null, day: day ?? null },
            ['date', 'archive', 'index'],
            {
              type: 'post',
              date: { year, ...(month === undefined ? {} : { month }), ...(day === undefined ? {} : { day }) },
            },
            page,
            visitor,
            settings,
          )
        }
      }

      // The page of posts when the front page is static (K-226).
      if (settings.show_on_front === 'page' && settings.page_for_posts !== null) {
        const postsPage = await findPublishedById(db, settings.page_for_posts)
        if (postsPage !== undefined && (await pathOf(postsPage, settings)) === `/${segments.join('/')}/`) {
          return archive('home', { type: 'home' }, ['home', 'index'], { type: 'post' }, page, visitor, settings, [
            `content:${postsPage.id}`,
          ])
        }
      }

      // A page by its whole path, or a post by its slug; `/<slug>/2/` is the second page of an item split by page breaks.
      if (page !== 1) return notFound()
      let pageNumber = 1
      let itemSegments = segments
      const lastSegment = segments.at(-1) ?? ''
      if (segments.length >= 2 && /^\d{1,5}$/.test(lastSegment)) {
        pageNumber = Number(lastSegment)
        itemSegments = segments.slice(0, -1)
      }
      const asPage = await pageAt(itemSegments)
      const asPost =
        asPage === undefined && itemSegments.length === 1
          ? await findPublishedPost(db, itemSegments[0] ?? '')
          : undefined
      const row = asPage ?? asPost
      if (row === undefined || pageNumber < 1) return notFound()
      // The front page lives at `/`; its own path goes there.
      if (frontPath(row, settings) !== undefined) {
        return { kind: 'redirect', status: 301, location: '/', cacheTags: [`content:${row.id}`, 'settings'] }
      }
      // An address without the closing slash goes to the one with it (WordPress' canonical redirect).
      if (!url.pathname.endsWith('/')) {
        // Built from the decoded segments, never from the raw path: `/.//host` would otherwise become `//host/`, another site.
        const canonical = `/${[...itemSegments, ...(pageNumber > 1 ? [String(pageNumber)] : [])].map(encodeURIComponent).join('/')}/`
        return { kind: 'redirect', status: 301, location: canonical, cacheTags: [`content:${row.id}`] }
      }
      return single(row, visitor, settings, pageNumber)
    },

    async query(query, visitor) {
      const settings = await settingsOf()
      const filter: Omit<PublicListFilter, 'searchConfig' | 'timeZone'> = { type: query.type }
      let termIds: string[] | undefined
      const extraTags: string[] = []
      if (query.category !== undefined) {
        const term = await findTermBySlug(db, 'category', query.category)
        termIds = term === undefined ? [] : await termWithDescendants(db, term.id)
        if (term !== undefined) extraTags.push(`term:${term.id}`)
      }
      if (query.tag !== undefined) {
        const term = await findTermBySlug(db, 'post_tag', query.tag)
        // Category and tag together: the posts in both (WordPress' AND of the two).
        const tagIds = term === undefined ? [] : [term.id]
        termIds = termIds === undefined ? tagIds : termIds.length === 0 || tagIds.length === 0 ? [] : termIds
        if (term !== undefined) extraTags.push(`term:${term.id}`)
      }
      let authorId: string | undefined
      if (query.author !== undefined) {
        authorId = (await findAuthorByNicename(db, query.author))?.id ?? '00000000-0000-0000-0000-000000000000'
      }
      const result = await list(
        {
          ...filter,
          ...(termIds === undefined ? {} : { termIds }),
          ...(authorId === undefined ? {} : { authorId }),
          ...(query.year === undefined
            ? {}
            : {
                date: {
                  year: query.year,
                  ...(query.month === undefined ? {} : { month: query.month }),
                  ...(query.day === undefined ? {} : { day: query.day }),
                },
              }),
          ...(query.search === undefined || query.search === '' ? {} : { search: query.search }),
          ...(query.exclude_sticky === 'true' ? { excludeSticky: true } : {}),
        },
        { orderby: query.orderby, order: query.order, stickyFirst: query.sticky_first === 'true' },
        query.page,
        query.per_page ?? settings.posts_per_page,
        visitor,
        settings,
      )
      return { ...result.list, cacheTags: [...result.tags, ...extraTags] }
    },

    async unlock(contentId, password, ip) {
      const attempt = await limiter.begin('post_password', { ip, login: `content:${contentId}` })
      assertNotDelayed(attempt.status, clock())
      const row = await findPublishedById(db, contentId)
      // The same work whether or not the item exists or has a password.
      const check = await verifyPassword(password, row?.passwordHash ?? (await dummyPasswordHash()))
      if (row?.passwordHash == null || !check.valid) return undefined
      await limiter.succeed(attempt)
      return passCookieFor(row.passwordHash)
    },

    async preview(token, page) {
      const match = /^v1\.([A-Za-z0-9_-]{10,400})\.([A-Za-z0-9_-]{43})$/.exec(token)
      if (match === null) throw new NotFoundError()
      const [, payload = '', signature = ''] = match
      const expected = base64url(createHmac('sha256', signingKey).update(`toascribe:preview\0${payload}`).digest())
      if (!sameSecret(expected, signature)) throw new NotFoundError()
      let claims: unknown
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        throw new NotFoundError()
      }
      const c: unknown = typeof claims === 'object' && claims !== null ? Reflect.get(claims, 'c') : undefined
      const s: unknown = typeof claims === 'object' && claims !== null ? Reflect.get(claims, 's') : undefined
      const e: unknown = typeof claims === 'object' && claims !== null ? Reflect.get(claims, 'e') : undefined
      const now = clock()
      if (typeof c !== 'string' || typeof s !== 'string' || typeof e !== 'number' || e * 1000 <= now.getTime()) {
        throw new NotFoundError()
      }
      // The link dies with the session that made it (a logout, or the session running out), and with the right to edit the item.
      const accountId = await liveSessionAccount(db, s, now)
      if (accountId === undefined || !(await mayEdit(accountId, c))) throw new NotFoundError()
      const row = await findAnyById(db, c)
      if (row === undefined) throw new NotFoundError()
      const settings = await settingsOf()
      // The preview shows the item as it is stored, a password item included: the account that made the link may edit it.
      const opened: PublicRow = { ...row, passwordHash: null }
      const found = await contentOf(opened, {}, settings, page)
      if (found === undefined) throw new NotFoundError()
      return {
        kind: row.type === 'page' ? 'page' : 'single',
        status: 200,
        templates: singleTemplates(row, false),
        content: { ...found.content, protected: row.passwordHash !== null },
        cacheTags: [],
      }
    },

    async previewLink(auth, contentId) {
      if (!(await mayEdit(auth.account.id, contentId))) throw new NotFoundError()
      const row = { id: contentId }
      const expires = new Date(clock().getTime() + PREVIEW_LINK_MINUTES * 60_000)
      const payload = base64url(
        JSON.stringify({ c: row.id, s: auth.session.id, e: Math.floor(expires.getTime() / 1000) }),
      )
      const signature = base64url(createHmac('sha256', signingKey).update(`toascribe:preview\0${payload}`).digest())
      return { path: `/?preview=v1.${payload}.${signature}`, expiresAt: expires.toISOString() }
    },

    async changes(since) {
      const now = clock()
      const xmin = await oldestRunningXid(db)
      const cursor = `${xmin}.${String(now.getTime())}`
      const [sinceXid, sinceMs] = since === undefined ? [] : since.split('.')
      // The first look, or one older than the log keeps: everything may have changed.
      if (sinceXid === undefined || sinceMs === undefined || now.getTime() - Number(sinceMs) > CHANGES_KEPT_MS) {
        return { cursor, all: true, tags: [] }
      }
      const tags = await tagsChangedSince(db, sinceXid)
      if (tags === undefined || tags.includes('*')) return { cursor, all: true, tags: [] }
      return { cursor, all: false, tags }
    },
  }
  return service
}

/** Two secrets compared in constant time (a different length is no match). */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
