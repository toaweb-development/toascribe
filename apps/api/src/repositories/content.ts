// The content API's queries (M1.1, typescript §8): `content` and `content_author`, read for the lists and written by the content
// service. The slug and the permanent delete are shared with the worker and live in @toascribe/db.
import { schema } from '@toascribe/db'
import type {
  Blocks,
  CommentStatus,
  ContentCounts,
  ContentOrderBy,
  ContentStatus,
  ContentStatusBeforeTrash,
  ContentTypeKey,
} from '@toascribe/shared'
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Executor } from './executor.ts'
import { escapeLike } from './users.ts'

const { account, accountRole, content, contentAuthor, role } = schema

/** One row of `content`, without the block tree and the search vector (the list does not need them). */
export interface ContentRow {
  readonly id: string
  readonly shortId: number
  readonly type: ContentTypeKey
  readonly locale: string
  readonly slug: string
  readonly title: string
  readonly excerpt: string
  readonly status: ContentStatus
  readonly statusBeforeTrash: ContentStatusBeforeTrash | null
  readonly hasPassword: boolean
  readonly sticky: boolean
  readonly commentStatus: CommentStatus
  readonly menuOrder: number
  readonly template: string | null
  readonly parentId: string | null
  readonly publishedAt: Date | null
  readonly unpublishAt: Date | null
  readonly createdAt: Date
  readonly modifiedAt: Date
}

// The columns are checked in the database: type by the service (only post and page are written), status, status_before_trash
// and comment_status by their CHECK constraints.
const rowColumns = {
  id: content.id,
  shortId: content.shortId,
  type: sql<ContentTypeKey>`${content.type}`,
  locale: content.locale,
  slug: content.slug,
  title: content.title,
  excerpt: content.excerpt,
  status: sql<ContentStatus>`${content.status}`,
  statusBeforeTrash: sql<ContentStatusBeforeTrash | null>`${content.statusBeforeTrash}`,
  hasPassword: sql<boolean>`${content.passwordHash} is not null`,
  sticky: content.sticky,
  commentStatus: sql<CommentStatus>`${content.commentStatus}`,
  menuOrder: content.menuOrder,
  template: content.template,
  parentId: content.parentId,
  publishedAt: content.publishedAt,
  unpublishAt: content.unpublishAt,
  createdAt: content.createdAt,
  modifiedAt: content.modifiedAt,
}

/** The date a list shows and sorts by: the publish date when there is one, otherwise the last change (WordPress' post_date). */
export const listDate: SQL = sql`coalesce(${content.publishedAt}, ${content.modifiedAt})`

/** The site's time zone as PostgreSQL takes it after `at time zone`: an IANA name, or an offset in minutes east of UTC. */
export type SiteTimeZone = { readonly name: string } | { readonly offsetMinutes: number }

function localMonth(zone: SiteTimeZone): SQL {
  const local =
    'name' in zone
      ? sql`(${listDate} at time zone ${zone.name})`
      : sql`(${listDate} at time zone make_interval(mins => ${zone.offsetMinutes}))`
  return sql`to_char(${local}, 'YYYY-MM')`
}

export interface Visibility {
  readonly type: ContentTypeKey
  /** The account asking: its own private items are visible. */
  readonly accountId: string
  /** Holds `read_private_*` of the type: everyone's private items are visible. */
  readonly readPrivate: boolean
}

function isAuthor(accountId: string): SQL {
  return sql`exists (select 1 from ${contentAuthor}
    where ${contentAuthor.contentId} = ${content.id} and ${contentAuthor.accountId} = ${accountId})`
}

/**
 * The items of the type the account may see in a list: everything but someone else's private item without `read_private_*`, also
 * once it is in the trash (a trashed item keeps the protection of the status it had).
 */
function visibleCondition(visibility: Visibility): SQL {
  const own = isAuthor(visibility.accountId)
  const wasPrivate = sql`(${content.status} = 'private' or (${content.status} = 'trash' and ${content.statusBeforeTrash} = 'private'))`
  return (
    and(eq(content.type, visibility.type), visibility.readPrivate ? undefined : or(sql`not ${wasPrivate}`, own)) ??
    sql`true`
  )
}

export interface ListFilter {
  readonly status: 'all' | ContentStatus
  readonly author: string | undefined
  /** Already trimmed; empty means none. */
  readonly search: string | undefined
  readonly month: string | undefined
}

/**
 * The words of a search as a prefix query (`'blab':* & 'ost':*`): each word keeps letters and digits only, so the text needs no
 * further quoting. Empty when no word is left.
 */
export function prefixQuery(search: string): string {
  return search
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word !== '')
    .slice(0, 16)
    .map((word) => `'${word}':*`)
    .join(' & ')
}

export interface ListContext {
  readonly visibility: Visibility
  readonly filter: ListFilter
  readonly zone: SiteTimeZone
  /** The text search configuration of the site's language (DATAMODEL «Full-text search»). */
  readonly searchConfig: string
}

function listCondition(context: ListContext): SQL {
  const { filter } = context
  const conditions: (SQL | undefined)[] = [visibleCondition(context.visibility)]
  conditions.push(filter.status === 'all' ? ne(content.status, 'trash') : eq(content.status, filter.status))
  if (filter.author !== undefined) {
    conditions.push(isAuthor(filter.author))
  }
  if (filter.month !== undefined) {
    conditions.push(sql`${localMonth(context.zone)} = ${filter.month}`)
  }
  if (filter.search !== undefined && filter.search !== '') {
    const title = sql`${content.title} ilike ${`%${escapeLike(filter.search)}%`}`
    const query = prefixQuery(filter.search)
    conditions.push(
      query === ''
        ? title
        : or(sql`${content.search} @@ to_tsquery(${context.searchConfig}::regconfig, ${query})`, title),
    )
  }
  return and(...conditions) ?? sql`true`
}

function orderBy(orderby: ContentOrderBy, order: 'asc' | 'desc'): SQL[] {
  const direction = order === 'asc' ? asc : desc
  switch (orderby) {
    case 'date':
      return [direction(listDate), direction(content.id)]
    case 'title':
      return [direction(sql`lower(${content.title})`), direction(content.id)]
    case 'modified':
      return [direction(content.modifiedAt), direction(content.id)]
    case 'menu_order':
      return [direction(content.menuOrder), direction(sql`lower(${content.title})`), direction(content.id)]
    default:
      return orderby satisfies never
  }
}

/** One page of the items that match, sorted. */
export function listContentPage(
  db: Executor,
  context: ListContext,
  orderby: ContentOrderBy,
  order: 'asc' | 'desc',
  limit: number,
  offset: number,
): Promise<ContentRow[]> {
  return db
    .select(rowColumns)
    .from(content)
    .where(listCondition(context))
    .orderBy(...orderBy(orderby, order))
    .limit(limit)
    .offset(offset)
}

export async function countContent(db: Executor, context: ListContext): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(content)
    .where(listCondition(context))
  return rows[0]?.n ?? 0
}

export interface TreeNode {
  readonly id: string
  readonly parentId: string | null
}

/** Every matching item as a node of the page tree, in `menu_order`, title order (the order of siblings). */
export function listContentTree(db: Executor, context: ListContext, order: 'asc' | 'desc'): Promise<TreeNode[]> {
  return db
    .select({ id: content.id, parentId: content.parentId })
    .from(content)
    .where(listCondition(context))
    .orderBy(...orderBy('menu_order', order))
}

/** The rows with these ids (in no order). */
export function findContentRows(db: Executor, ids: readonly string[]): Promise<ContentRow[]> {
  if (ids.length === 0) {
    return Promise.resolve([])
  }
  return db
    .select(rowColumns)
    .from(content)
    .where(inArray(content.id, [...ids]))
}

/** The views' counts for the type (WordPress' `wp_count_posts`, with «Mine»): independent of search, author, month and page. */
export async function countByStatus(db: Executor, visibility: Visibility): Promise<ContentCounts> {
  const own = isAuthor(visibility.accountId)
  const status = (value: ContentStatus) => sql<number>`(count(*) filter (where ${content.status} = ${value}))::int`
  const [row] = await db
    .select({
      all: sql<number>`(count(*) filter (where ${content.status} <> 'trash'))::int`,
      mine: sql<number>`(count(*) filter (where ${content.status} <> 'trash' and ${own}))::int`,
      publish: status('publish'),
      draft: status('draft'),
      pending: status('pending'),
      future: status('future'),
      private: status('private'),
      trash: status('trash'),
    })
    .from(content)
    .where(visibleCondition(visibility))
  return row ?? { all: 0, mine: 0, publish: 0, draft: 0, pending: 0, future: 0, private: 0, trash: 0 }
}

/** The months with visible items, newest first: in the trash view the trash's months, otherwise those outside it. */
export async function listMonths(
  db: Executor,
  visibility: Visibility,
  zone: SiteTimeZone,
  trash: boolean,
): Promise<string[]> {
  const month = localMonth(zone)
  const rows = await db
    .selectDistinct({ month: sql<string>`${month}` })
    .from(content)
    .where(and(visibleCondition(visibility), trash ? eq(content.status, 'trash') : ne(content.status, 'trash')))
  // Sorted here: `YYYY-MM` sorts as text, and an ORDER BY would bind the time zone a second time, which DISTINCT refuses.
  return rows.map((row) => row.month).sort((a, b) => b.localeCompare(a))
}

export interface AuthorRow {
  readonly contentId: string
  readonly id: string
  readonly username: string
  readonly displayName: string
}

/** The authors of each of these items, in their order. */
export async function authorsOf(db: Executor, contentIds: readonly string[]): Promise<Map<string, AuthorRow[]>> {
  const authors = new Map<string, AuthorRow[]>()
  if (contentIds.length === 0) {
    return authors
  }
  const rows = await db
    .select({
      contentId: contentAuthor.contentId,
      id: account.id,
      username: account.username,
      displayName: account.displayName,
    })
    .from(contentAuthor)
    .innerJoin(account, eq(account.id, contentAuthor.accountId))
    .where(inArray(contentAuthor.contentId, [...contentIds]))
    .orderBy(contentAuthor.contentId, contentAuthor.sort, account.username)
  for (const row of rows) {
    authors.set(row.contentId, [...(authors.get(row.contentId) ?? []), row])
  }
  return authors
}

export interface StoredContent extends ContentRow {
  readonly blocks: Blocks
}

/** One item with its block tree. `forUpdate` locks the row until the end of the transaction. */
export async function findContent(
  db: Executor,
  id: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<StoredContent | undefined> {
  const query = db
    .select({ ...rowColumns, blocks: content.blocks })
    .from(content)
    .where(eq(content.id, id))
  const rows = await (options.forUpdate === true ? query.for('update', { of: content }) : query)
  return rows[0]
}

/** Serialises the changes of parents in one page tree (type and language) until the end of the transaction. */
export async function lockPageTree(db: Executor, type: string, locale: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`toascribe:content-tree:${type}:${locale}`}, 0))`,
  )
}

/** The ids of the parent chain of a page, from its parent up (for the cycle check). Stops after 10 000 levels. */
export async function ancestorIds(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive chain(id, parent_id, depth) as (
      select id, parent_id, 0 from content where id = ${id}
      union all
      select c.id, c.parent_id, chain.depth + 1 from content c join chain on c.id = chain.parent_id where chain.depth < 10000
    )
    select id from chain where depth > 0`)
  return result.rows.map((row) => row.id)
}

/** The active accounts among `ids` and the capabilities their roles give them. An unknown or inactive id is not in the map. */
export async function capabilitiesOf(db: Executor, ids: readonly string[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>()
  if (ids.length === 0) {
    return found
  }
  const accounts = await db
    .select({ id: account.id })
    .from(account)
    .where(and(inArray(account.id, [...ids]), eq(account.status, 'active')))
  for (const row of accounts) {
    found.set(row.id, new Set())
  }
  const grants = await db
    .select({ accountId: accountRole.accountId, capabilities: role.capabilities })
    .from(accountRole)
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(inArray(accountRole.accountId, [...ids]))
  for (const grant of grants) {
    for (const capability of grant.capabilities) {
      found.get(grant.accountId)?.add(capability)
    }
  }
  return found
}

/** The values a save writes. `search` is the text of the three weighted parts; the vector is built in SQL. */
export interface ContentValues {
  readonly slug: string
  readonly title: string
  readonly excerpt: string
  readonly status: ContentStatus
  readonly statusBeforeTrash: ContentStatusBeforeTrash | null
  readonly passwordHash: string | null
  readonly sticky: boolean
  readonly commentStatus: CommentStatus
  readonly menuOrder: number
  readonly template: string | null
  readonly parentId: string | null
  readonly publishedAt: Date | null
  readonly unpublishAt: Date | null
  readonly blocks: Blocks
}

export interface SearchText {
  readonly config: string
  readonly title: string
  readonly excerpt: string
  readonly blocks: string
}

/** The search vector of DATAMODEL «Full-text search»: title A, excerpt B, block text C. */
export function searchVector(text: SearchText): SQL {
  const config = sql`${text.config}::regconfig`
  return sql`setweight(to_tsvector(${config}, ${text.title}), 'A')
    || setweight(to_tsvector(${config}, ${text.excerpt}), 'B')
    || setweight(to_tsvector(${config}, ${text.blocks}), 'C')`
}

/** Inserts an item and returns its id and short id. */
export async function insertContent(
  db: Executor,
  input: ContentValues & { readonly type: ContentTypeKey; readonly locale: string; readonly at: Date },
  search: SearchText,
): Promise<{ id: string; shortId: number }> {
  const [row] = await db
    .insert(content)
    .values({
      type: input.type,
      locale: input.locale,
      slug: input.slug,
      title: input.title,
      excerpt: input.excerpt,
      status: input.status,
      statusBeforeTrash: input.statusBeforeTrash,
      passwordHash: input.passwordHash,
      sticky: input.sticky,
      commentStatus: input.commentStatus,
      menuOrder: input.menuOrder,
      template: input.template,
      parentId: input.parentId,
      publishedAt: input.publishedAt,
      unpublishAt: input.unpublishAt,
      blocks: input.blocks,
      search: searchVector(search),
      createdAt: input.at,
      modifiedAt: input.at,
    })
    .returning({ id: content.id, shortId: content.shortId })
  if (row === undefined) {
    throw new Error('insert into content returned no row')
  }
  return row
}

/** Writes the changed columns of an item; `search` rebuilds the vector when given. Sets `modified_at`. */
export async function updateContent(
  db: Executor,
  id: string,
  changes: Partial<ContentValues>,
  at: Date,
  search?: SearchText,
): Promise<void> {
  await db
    .update(content)
    .set({ ...changes, ...(search === undefined ? {} : { search: searchVector(search) }), modifiedAt: at })
    .where(eq(content.id, id))
}

/** Replaces the authors of an item, in order. */
export async function replaceAuthors(db: Executor, contentId: string, accountIds: readonly string[], at: Date) {
  await db.delete(contentAuthor).where(eq(contentAuthor.contentId, contentId))
  await db
    .insert(contentAuthor)
    .values(accountIds.map((accountId, sort) => ({ contentId, accountId, sort, createdAt: at })))
}

/** The active accounts whose roles give them `capability`, by display name. */
export function accountsWithCapability(db: Executor, capability: string): Promise<AuthorRow[]> {
  return db
    .selectDistinct({
      contentId: sql<string>`''`,
      id: account.id,
      username: account.username,
      displayName: account.displayName,
    })
    .from(account)
    .innerJoin(accountRole, eq(accountRole.accountId, account.id))
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(and(eq(account.status, 'active'), sql`${capability} = any(${role.capabilities})`))
    .orderBy(account.displayName, account.username, account.id)
}

/** The ids of the trashed items of the type, oldest trash first. */
export async function trashedIds(db: Executor, type: ContentTypeKey): Promise<string[]> {
  const rows = await db
    .select({ id: content.id })
    .from(content)
    .where(and(eq(content.type, type), eq(content.status, 'trash')))
    .orderBy(content.modifiedAt, content.id)
  return rows.map((row) => row.id)
}

/** What the parent check needs to know about a candidate parent. */
export async function findParentCandidate(
  db: Executor,
  id: string,
): Promise<{ type: string; locale: string; status: string } | undefined> {
  const rows = await db
    .select({ type: content.type, locale: content.locale, status: content.status })
    .from(content)
    .where(eq(content.id, id))
    .limit(1)
  return rows[0]
}
