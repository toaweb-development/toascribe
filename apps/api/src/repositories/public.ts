// The public reading API's queries (M1.4, typescript §8). Every query here takes only content that is published (status `publish`, so
// its time has come) and of a type the site shows; the service adds what a visitor may see of a password-protected item. A private,
// draft, pending, scheduled or trashed item is never selected, whatever the caller asks.
import { schema } from '@toascribe/db'
import type { CommentStatus, ContentSeo, ContentTypeKey } from '@toascribe/shared'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Executor } from './executor.ts'
import { prefixQuery } from './content.ts'
import { escapeLike } from './users.ts'

const { account, cacheInvalidation, content, redirect, session, taxonomy, term } = schema

export interface PublicRow {
  readonly id: string
  readonly shortId: number
  readonly type: ContentTypeKey
  readonly slug: string
  readonly title: string
  readonly excerpt: string
  readonly passwordHash: string | null
  readonly sticky: boolean
  readonly publishedAt: Date
  readonly modifiedAt: Date
  readonly parentId: string | null
  readonly template: string | null
  readonly featuredMediaId: string | null
  readonly seo: unknown
  readonly blocks: unknown
  readonly commentStatus: CommentStatus
  readonly status: string
}

const columns = {
  id: content.id,
  shortId: content.shortId,
  type: sql<ContentTypeKey>`${content.type}`,
  slug: content.slug,
  title: content.title,
  excerpt: content.excerpt,
  passwordHash: content.passwordHash,
  sticky: content.sticky,
  // Not null for a published item (ck_content_published_at).
  publishedAt: sql<Date>`${content.publishedAt}`.mapWith(content.publishedAt),
  modifiedAt: content.modifiedAt,
  parentId: content.parentId,
  template: content.template,
  featuredMediaId: content.featuredMediaId,
  seo: content.seo,
  blocks: content.blocks,
  commentStatus: sql<CommentStatus>`${content.commentStatus}`,
  status: content.status,
}

/** Published and of a type the site shows: the one condition every public query starts from. */
const visible: SQL = sql`${content.status} = 'publish' and ${content.type} in ('post', 'page')`

function first<T>(rows: readonly T[]): T | undefined {
  return rows[0]
}

export async function findPublishedPost(db: Executor, slug: string): Promise<PublicRow | undefined> {
  return first(
    await db
      .select(columns)
      .from(content)
      .where(and(visible, eq(content.type, 'post'), eq(content.slug, slug)))
      .limit(1),
  )
}

/** The published pages with this slug, any parent: the caller matches the whole path. */
export async function findPublishedPages(db: Executor, slug: string): Promise<PublicRow[]> {
  return db
    .select(columns)
    .from(content)
    .where(and(visible, eq(content.type, 'page'), eq(content.slug, slug)))
    .limit(50)
}

/** Published items by id (posts and pages), in no order. */
export async function findPublishedByIds(db: Executor, ids: readonly string[]): Promise<PublicRow[]> {
  if (ids.length === 0) return []
  return db
    .select(columns)
    .from(content)
    .where(and(inArray(content.id, [...new Set(ids)]), visible))
}

export async function findPublishedById(db: Executor, id: string): Promise<PublicRow | undefined> {
  return first(
    await db
      .select(columns)
      .from(content)
      .where(and(visible, eq(content.id, id)))
      .limit(1),
  )
}

export async function findPublishedByShortId(db: Executor, shortId: number): Promise<PublicRow | undefined> {
  return first(
    await db
      .select(columns)
      .from(content)
      .where(and(visible, eq(content.shortId, shortId)))
      .limit(1),
  )
}

/** Any item by id, whatever its status: for a preview link only, which the service has checked. */
export async function findAnyById(db: Executor, id: string): Promise<PublicRow | undefined> {
  return first(
    await db
      // A draft has no publish time yet: it shows the time it was last changed.
      .select({
        ...columns,
        publishedAt: sql<Date>`coalesce(${content.publishedAt}, ${content.modifiedAt})`.mapWith(content.modifiedAt),
      })
      .from(content)
      .where(and(eq(content.id, id), sql`${content.type} in ('post', 'page')`))
      .limit(1),
  )
}

/**
 * The paths of pages (`/parent/child/`) and of the pages above them, from the slugs up the tree. Ancestors are read whatever their
 * status, as WordPress builds a page's link: a published page under a draft keeps its place in the tree.
 */
export async function pagePaths(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, { path: string; ancestors: string[] }>> {
  const found = new Map<string, { path: string; ancestors: string[] }>()
  if (ids.length === 0) return found
  const result = await db.execute<{ start: string; path: string; ancestors: string[] }>(sql`
    with recursive chain(start, id, parent_id, slug, depth) as (
      select id, id, parent_id, slug, 0 from content where id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
      union all
      select chain.start, c.id, c.parent_id, c.slug, chain.depth + 1
        from content c join chain on c.id = chain.parent_id where chain.depth < 50
    )
    select start,
           string_agg(slug, '/' order by depth desc) as path,
           coalesce(array_agg(id) filter (where depth > 0), '{}') as ancestors
      from chain group by start`)
  for (const row of result.rows) found.set(row.start, { path: `/${row.path}/`, ancestors: row.ancestors })
  return found
}

export interface PublicTermRow {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly taxonomy: 'category' | 'post_tag'
}

export async function findTermBySlug(
  db: Executor,
  taxonomySlug: 'category' | 'post_tag',
  slug: string,
): Promise<PublicTermRow | undefined> {
  return first(
    await db
      .select({
        id: term.id,
        name: term.name,
        slug: term.slug,
        taxonomy: sql<'category' | 'post_tag'>`${taxonomy.slug}`,
      })
      .from(term)
      .innerJoin(taxonomy, eq(taxonomy.id, term.taxonomyId))
      .where(and(eq(taxonomy.slug, taxonomySlug), eq(term.slug, slug)))
      .limit(1),
  )
}

/** A term and the terms below it (a category archive shows the posts of its children too, as in WordPress). */
export async function termWithDescendants(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive below(id, depth) as (
      select id, 0 from term where id = ${id}
      union all
      select t.id, below.depth + 1 from term t join below on t.parent_id = below.id where below.depth < 50
    )
    select id from below`)
  return result.rows.map((row) => row.id)
}

export interface PublicAuthorRow {
  readonly id: string
  readonly displayName: string
  readonly nicename: string
}

export async function findAuthorByNicename(db: Executor, nicename: string): Promise<PublicAuthorRow | undefined> {
  return first(
    await db
      .select({ id: account.id, displayName: account.displayName, nicename: account.nicename })
      .from(account)
      // Only an active account with something published has an archive, so the address does not confirm other usernames.
      .where(
        and(
          sql`lower(${account.nicename}) = lower(${nicename})`,
          eq(account.status, 'active'),
          sql`exists (select 1 from content_author join content on content.id = content_author.content_id
            where content_author.account_id = ${account.id} and ${visible})`,
        ),
      )
      .limit(1),
  )
}

/** The authors of items, in their order, with what an author archive needs (never an e-mail or a username). */
export async function publicAuthorsOf(db: Executor, ids: readonly string[]): Promise<Map<string, PublicAuthorRow[]>> {
  const found = new Map<string, PublicAuthorRow[]>()
  if (ids.length === 0) return found
  const result = await db.execute<{ content_id: string; id: string; display_name: string; nicename: string }>(sql`
    select ca.content_id, a.id, a.display_name, a.nicename
      from content_author ca join account a on a.id = ca.account_id
     where ca.content_id in (${sql.join(
       ids.map((id) => sql`${id}`),
       sql`, `,
     )})
     order by ca.content_id, ca.sort`)
  for (const row of result.rows) {
    const list = found.get(row.content_id) ?? []
    list.push({ id: row.id, displayName: row.display_name, nicename: row.nicename })
    found.set(row.content_id, list)
  }
  return found
}

export interface PublicListFilter {
  readonly type: ContentTypeKey
  readonly termIds?: readonly string[]
  readonly authorId?: string
  /** A date archive: the year, and the month and day when given, in the site's time zone. */
  readonly date?: { readonly year: number; readonly month?: number; readonly day?: number }
  /** The site's time zone as PostgreSQL takes it after `at time zone`: an IANA name or an offset `+01:00`. */
  readonly timeZone: string
  readonly search?: string
  readonly searchConfig: string
  readonly excludeSticky?: boolean
  /** Several types (a search looks at posts and pages). */
  readonly types?: readonly ContentTypeKey[]
}

function listCondition(filter: PublicListFilter): SQL {
  const conditions: SQL[] = [visible]
  const types = filter.types ?? [filter.type]
  conditions.push(inArray(content.type, [...types]))
  if (filter.termIds !== undefined) {
    const ids = filter.termIds.length === 0 ? [sql`null`] : filter.termIds.map((id) => sql`${id}`)
    conditions.push(
      sql`exists (select 1 from content_term where content_term.content_id = ${content.id}
        and content_term.term_id in (${sql.join(ids, sql`, `)}))`,
    )
  }
  if (filter.authorId !== undefined) {
    conditions.push(
      sql`exists (select 1 from content_author where content_author.content_id = ${content.id}
        and content_author.account_id = ${filter.authorId})`,
    )
  }
  if (filter.date !== undefined) {
    const local = sql`(${content.publishedAt} at time zone ${filter.timeZone})`
    conditions.push(sql`extract(year from ${local}) = ${filter.date.year}`)
    if (filter.date.month !== undefined) conditions.push(sql`extract(month from ${local}) = ${filter.date.month}`)
    if (filter.date.day !== undefined) conditions.push(sql`extract(day from ${local}) = ${filter.date.day}`)
  }
  if (filter.excludeSticky === true) conditions.push(sql`not ${content.sticky}`)
  if (filter.search !== undefined && filter.search !== '') {
    // A password-protected item is left out of a search, as WordPress leaves it out of a visitor's: its stored search text holds
    // its hidden body and excerpt, and a match would tell which words are in them.
    conditions.push(sql`${content.passwordHash} is null`)
    const title = sql`${content.title} ilike ${`%${escapeLike(filter.search)}%`}`
    const query = prefixQuery(filter.search)
    conditions.push(
      query === ''
        ? title
        : sql`(${content.search} @@ to_tsquery(${filter.searchConfig}::regconfig, ${query}) or ${title})`,
    )
  }
  return and(...conditions) ?? sql`true`
}

export async function listPublic(
  db: Executor,
  filter: PublicListFilter,
  order: {
    readonly orderby: 'date' | 'title' | 'menu_order'
    readonly order: 'asc' | 'desc'
    readonly stickyFirst: boolean
  },
  limit: number,
  offset: number,
): Promise<{ rows: PublicRow[]; total: number }> {
  const direction = order.order === 'asc' ? asc : desc
  const sorting: SQL[] = []
  if (order.stickyFirst) sorting.push(desc(content.sticky))
  if (order.orderby === 'title') sorting.push(direction(sql`lower(${content.title})`))
  else if (order.orderby === 'menu_order') sorting.push(direction(content.menuOrder), asc(sql`lower(${content.title})`))
  sorting.push(direction(content.publishedAt), direction(content.id))
  const where = listCondition(filter)
  const [rows, counted] = await Promise.all([
    db
      .select(columns)
      .from(content)
      .where(where)
      .orderBy(...sorting)
      .limit(limit)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(content)
      .where(where),
  ])
  return { rows, total: counted[0]?.n ?? 0 }
}

/** The account of a session that is still live (not ended by a logout, not expired), or undefined. */
export async function liveSessionAccount(db: Executor, id: string, now: Date): Promise<string | undefined> {
  const rows = await db
    .select({ accountId: session.accountId })
    .from(session)
    .where(and(eq(session.id, id), sql`${session.expiresAt} > ${now}`))
    .limit(1)
  return rows[0]?.accountId
}

// --- Permalinks (M1.5) ---------------------------------------------------------------------------------------------------------

/** Each category's slug with its parents' in front, `nyheter/lokalt` (WordPress' category path). */
export async function categoryChains(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.execute<{ start: string; slug: string; depth: number }>(sql`
    with recursive chain(start, id, parent_id, slug, depth) as (
      select id, id, parent_id, slug, 0 from term where id in (${sql.join(
        [...new Set(ids)].map((id) => sql`${id}`),
        sql`, `,
      )})
      union all
      select chain.start, t.id, t.parent_id, t.slug, chain.depth + 1
        from term t join chain on t.id = chain.parent_id where chain.depth < 50
    )
    select start, slug, depth from chain order by start, depth desc`)
  const chains = new Map<string, string[]>()
  for (const row of result.rows) {
    const list = chains.get(row.start) ?? []
    list.push(row.slug)
    chains.set(row.start, list)
  }
  return new Map([...chains].map(([id, slugs]) => [id, slugs.join('/')]))
}

/** The category that goes into %category% for each post: the first in the post's order, as WordPress takes the first. */
export async function firstCategoryOf(db: Executor, contentIds: readonly string[]): Promise<Map<string, string>> {
  if (contentIds.length === 0) return new Map()
  const result = await db.execute<{ content_id: string; term_id: string }>(sql`
    select distinct on (ct.content_id) ct.content_id, ct.term_id
      from content_term ct
      join term t on t.id = ct.term_id
      join taxonomy x on x.id = t.taxonomy_id and x.slug = 'category'
     where ct.content_id in (${sql.join(
       contentIds.map((id) => sql`${id}`),
       sql`, `,
     )})
     order by ct.content_id, ct.sort, t.slug`)
  return new Map(result.rows.map((row) => [row.content_id, row.term_id]))
}

/** A published post by its short id (`%post_id%`). */
export async function findPublishedPostByShortId(db: Executor, shortId: number): Promise<PublicRow | undefined> {
  const row = await findPublishedByShortId(db, shortId)
  return row?.type === 'post' ? row : undefined
}

/** The published pages below a page, at any depth (their addresses change with it). */
export async function publishedDescendantIds(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive below(id, depth) as (
      select id, 0 from content where parent_id = ${id} and type = 'page' and status = 'publish'
      union all
      select c.id, below.depth + 1 from content c join below on c.parent_id = below.id
       where c.type = 'page' and c.status = 'publish' and below.depth < 50
    )
    select id from below`)
  return result.rows.map((row) => row.id)
}

/** Where an old address of an item goes (K-207): the item, whose address now is worked out when it is asked for. */
export async function findRedirect(
  db: Executor,
  source: string,
): Promise<{ contentId: string | null; target: string | null; statusCode: number } | undefined> {
  const rows = await db
    .select({ contentId: redirect.contentId, target: redirect.target, statusCode: redirect.statusCode })
    .from(redirect)
    .where(eq(redirect.source, source))
    .limit(1)
  return rows[0]
}

/**
 * Remembers that the item had these addresses (K-207): each sends visitors to the item from now on. An address that already
 * points somewhere is pointed here instead; the item's own address now is never kept (it is no old address).
 */
export async function rememberOldPaths(
  db: Executor,
  contentId: string,
  oldPaths: readonly string[],
  currentPaths: readonly string[],
  at: Date,
): Promise<void> {
  const current = new Set(currentPaths)
  const sources = [...new Set(oldPaths)].filter((path) => !current.has(path) && path.length <= 2000)
  if (currentPaths.length > 0) {
    // An address in use again (a slug changed back) is no redirect any more.
    await db.delete(redirect).where(inArray(redirect.source, [...current]))
  }
  if (sources.length === 0) return
  await db
    .insert(redirect)
    .values(
      sources.map((source) => ({
        source,
        contentId,
        statusCode: 301,
        origin: 'slug_change',
        createdAt: at,
        modifiedAt: at,
      })),
    )
    .onConflictDoUpdate({
      target: redirect.source,
      set: { contentId, target: null, statusCode: 301, origin: 'slug_change', modifiedAt: at },
    })
}

// --- Cache invalidation ----------------------------------------------------------------------------------------------------------

/** Writes the tags a change touched (in the change's transaction, so a rolled-back change touches nothing). */
export async function recordInvalidation(db: Executor, tags: readonly string[], at: Date): Promise<void> {
  const unique = [...new Set(tags)]
  if (unique.length === 0) return
  await db.insert(cacheInvalidation).values(unique.map((tag) => ({ tag, changedAt: at })))
}

/** At most this many distinct tags in one answer; more, and the site drops everything. */
const MAX_CHANGED_TAGS = 5000

/**
 * The oldest transaction still running (`pg_snapshot_xmin`): every change not yet committed has an id at least this, so the next
 * look from here sees it. Read before the rows, so a change between the two is seen twice at worst, never not at all.
 */
export async function oldestRunningXid(db: Executor): Promise<string> {
  const result = await db.execute<{ xmin: string }>(sql`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin`)
  const xmin = result.rows[0]?.xmin
  if (xmin === undefined) throw new Error('pg_current_snapshot gave no row')
  return xmin
}

/** The distinct tags written by transactions from `sinceXid` on; undefined when there are too many to list. */
export async function tagsChangedSince(db: Executor, sinceXid: string): Promise<string[] | undefined> {
  const rows = await db
    .selectDistinct({ tag: cacheInvalidation.tag })
    .from(cacheInvalidation)
    .where(sql`${cacheInvalidation.xid} >= ${sinceXid}::xid8`)
    .limit(MAX_CHANGED_TAGS + 1)
  return rows.length > MAX_CHANGED_TAGS ? undefined : rows.map((row) => row.tag)
}

export type { ContentSeo }

// The sitemap (M1.6, K-223; WordPress' wp-sitemap). What a search engine may index: published, public items without a password and
// without «noindex» (the SEO panel), terms and authors with such a post.

/** What the sitemap leaves out of the published items: a password, or «noindex». */
// `noindex` compared as JSON, with no cast: a stored value that is not a boolean cannot make the query fail (only `true` counts).
const indexable: SQL = sql`${visible} and ${content.passwordHash} is null and coalesce(${content.seo}->'noindex' = 'true'::jsonb, false) = false`

export async function countIndexable(db: Executor, type: 'post' | 'page'): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(content)
    .where(and(indexable, eq(content.type, type)))
  return row?.count ?? 0
}

/** One file's worth of indexable items of a type, oldest first (a new item lands on the last file, as in WordPress). */
export async function listIndexable(
  db: Executor,
  type: 'post' | 'page',
  limit: number,
  offset: number,
): Promise<PublicRow[]> {
  return db
    .select(columns)
    .from(content)
    .where(and(indexable, eq(content.type, type)))
    .orderBy(asc(content.publishedAt), asc(content.id))
    .limit(limit)
    .offset(offset)
}

/** A term's own indexable posts (WordPress' sitemap counts the term's own posts, not its children's). */
const termHasPosts: SQL = sql`exists (select 1 from content_term join content on content.id = content_term.content_id
  where content_term.term_id = ${term.id} and ${indexable} and content.type = 'post')`

export async function countIndexableTerms(db: Executor, taxonomySlug: 'category' | 'post_tag'): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(term)
    .innerJoin(taxonomy, eq(taxonomy.id, term.taxonomyId))
    .where(and(eq(taxonomy.slug, taxonomySlug), termHasPosts))
  return row?.count ?? 0
}

export async function listIndexableTerms(
  db: Executor,
  taxonomySlug: 'category' | 'post_tag',
  limit: number,
  offset: number,
): Promise<{ id: string; slug: string }[]> {
  return db
    .select({ id: term.id, slug: term.slug })
    .from(term)
    .innerJoin(taxonomy, eq(taxonomy.id, term.taxonomyId))
    .where(and(eq(taxonomy.slug, taxonomySlug), termHasPosts))
    .orderBy(asc(term.slug), asc(term.id))
    .limit(limit)
    .offset(offset)
}

/** An active account with an indexable post (its author archive), as findAuthorByNicename lets through. */
const authorHasPosts: SQL = sql`${account.status} = 'active' and exists (select 1 from content_author
  join content on content.id = content_author.content_id
  where content_author.account_id = ${account.id} and ${indexable} and content.type = 'post')`

export async function countIndexableAuthors(db: Executor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(account)
    .where(authorHasPosts)
  return row?.count ?? 0
}

export async function listIndexableAuthors(
  db: Executor,
  limit: number,
  offset: number,
): Promise<{ nicename: string }[]> {
  return db
    .select({ nicename: account.nicename })
    .from(account)
    .where(authorHasPosts)
    .orderBy(asc(account.nicename), asc(account.id))
    .limit(limit)
    .offset(offset)
}
