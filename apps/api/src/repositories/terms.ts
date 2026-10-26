// Taxonomies, terms and their links to content (M1.2, typescript §8): `taxonomy`, `term` and `content_term`.
import { schema } from '@toascribe/db'
import { truncateSlug } from '@toascribe/shared'
import type { BuiltInTaxonomy, TermOrderBy } from '@toascribe/shared'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Executor } from './executor.ts'
import { escapeLike } from './users.ts'

const { contentTerm, taxonomy, term } = schema

export interface TaxonomyRow {
  readonly id: string
  readonly slug: BuiltInTaxonomy
  readonly name: string
  readonly isHierarchical: boolean
  readonly contentTypes: readonly string[]
}

const taxonomyColumns = {
  id: taxonomy.id,
  // Only the built-in slugs are asked for (BuiltInTaxonomy in the routes).
  slug: sql<BuiltInTaxonomy>`${taxonomy.slug}`,
  name: taxonomy.name,
  isHierarchical: taxonomy.isHierarchical,
  contentTypes: taxonomy.contentTypes,
}

export function listTaxonomies(db: Executor): Promise<TaxonomyRow[]> {
  return db
    .select(taxonomyColumns)
    .from(taxonomy)
    .where(inArray(taxonomy.slug, ['category', 'post_tag']))
    .orderBy(taxonomy.slug)
}

export async function findTaxonomy(db: Executor, slug: BuiltInTaxonomy): Promise<TaxonomyRow | undefined> {
  const rows = await db.select(taxonomyColumns).from(taxonomy).where(eq(taxonomy.slug, slug)).limit(1)
  return rows[0]
}

export interface TermRow {
  readonly id: string
  readonly taxonomyId: string
  readonly parentId: string | null
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly count: number
}

/** Published items that have the term: WordPress' term count. */
// Written with the table names in full: in a select, Drizzle leaves a column of the main table unqualified (`"id"`), which inside
// the subquery would mean `content.id`.
const publishedCount = sql<number>`(select count(*)::int from content_term
  inner join content on content.id = content_term.content_id
  where content_term.term_id = "term"."id" and content.status = 'publish')`

const termColumns = {
  id: term.id,
  taxonomyId: term.taxonomyId,
  parentId: term.parentId,
  slug: term.slug,
  name: term.name,
  description: term.description,
  count: publishedCount,
}

function searchCondition(taxonomyId: string, search: string | undefined): SQL {
  const conditions: SQL[] = [eq(term.taxonomyId, taxonomyId)]
  if (search !== undefined && search !== '') {
    const pattern = `%${escapeLike(search)}%`
    conditions.push(
      sql`(${term.name} ilike ${pattern} or ${term.slug} ilike ${pattern} or ${term.description} ilike ${pattern})`,
    )
  }
  return and(...conditions) ?? sql`true`
}

function termOrder(orderby: TermOrderBy, order: 'asc' | 'desc'): SQL[] {
  const direction = order === 'asc' ? asc : desc
  switch (orderby) {
    case 'name':
      return [direction(sql`lower(${term.name})`), direction(term.id)]
    case 'slug':
      return [direction(term.slug), direction(term.id)]
    case 'count':
      return [direction(publishedCount), direction(sql`lower(${term.name})`), direction(term.id)]
    case 'description':
      return [direction(sql`lower(${term.description})`), direction(term.id)]
    default:
      return orderby satisfies never
  }
}

export function listTermPage(
  db: Executor,
  taxonomyId: string,
  search: string | undefined,
  orderby: TermOrderBy,
  order: 'asc' | 'desc',
  limit: number,
  offset: number,
): Promise<TermRow[]> {
  return db
    .select(termColumns)
    .from(term)
    .where(searchCondition(taxonomyId, search))
    .orderBy(...termOrder(orderby, order))
    .limit(limit)
    .offset(offset)
}

export async function countTerms(db: Executor, taxonomyId: string, search: string | undefined): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(term)
    .where(searchCondition(taxonomyId, search))
  return rows[0]?.n ?? 0
}

/** Every term of the taxonomy as a node of its tree, in name order (the order of siblings). */
export function listTermTree(
  db: Executor,
  taxonomyId: string,
  order: 'asc' | 'desc',
): Promise<{ id: string; parentId: string | null }[]> {
  return db
    .select({ id: term.id, parentId: term.parentId })
    .from(term)
    .where(eq(term.taxonomyId, taxonomyId))
    .orderBy(...termOrder('name', order))
}

export function findTermRows(db: Executor, ids: readonly string[]): Promise<TermRow[]> {
  if (ids.length === 0) {
    return Promise.resolve([])
  }
  return db
    .select(termColumns)
    .from(term)
    .where(inArray(term.id, [...ids]))
}

/** One term of the taxonomy. `forUpdate` locks it until the end of the transaction. */
export async function findTerm(
  db: Executor,
  taxonomyId: string,
  id: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<TermRow | undefined> {
  const query = db
    .select(termColumns)
    .from(term)
    .where(and(eq(term.taxonomyId, taxonomyId), eq(term.id, id)))
  const rows = await (options.forUpdate === true ? query.for('update', { of: term }) : query)
  return rows[0]
}

/**
 * Serialises the changes of one taxonomy's terms until the end of the transaction: a slug or a name is chosen, a parent is checked,
 * a term is deleted and its posts are moved, without another change in between.
 */
export async function lockTaxonomy(db: Executor, taxonomyId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`toascribe:taxonomy:${taxonomyId}`}, 0))`)
}

/** Whether a sibling (same parent; for a flat taxonomy, any term) already has this name, without regard to case. */
export async function nameTaken(
  db: Executor,
  taxonomyId: string,
  parentId: string | null,
  name: string,
  excludeId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: term.id })
    .from(term)
    .where(
      and(
        eq(term.taxonomyId, taxonomyId),
        parentId === null ? isNull(term.parentId) : eq(term.parentId, parentId),
        sql`lower(${term.name}) = lower(${name})`,
        excludeId === null ? undefined : ne(term.id, excludeId),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/**
 * A slug no other term of the taxonomy has (WordPress' `wp_unique_term_slug()`): the slug itself; for a child in a hierarchical
 * taxonomy then `slug-<parent slug>`; then `slug-2`, `slug-3`, ... Take `lockTaxonomy` first.
 */
export async function uniqueTermSlug(
  db: Executor,
  taxonomyId: string,
  slug: string,
  parentSlug: string | null,
  excludeId: string | null,
): Promise<string> {
  const base = truncateSlug(slug)
  const rows = await db
    .select({ slug: term.slug })
    .from(term)
    .where(
      and(
        eq(term.taxonomyId, taxonomyId),
        sql`starts_with(${term.slug}, ${truncateSlug(base, 180)})`,
        excludeId === null ? undefined : ne(term.id, excludeId),
      ),
    )
  const taken = new Set(rows.map((row) => row.slug))
  if (!taken.has(base)) {
    return base
  }
  if (parentSlug !== null) {
    const withParent = truncateSlug(`${base}-${parentSlug}`)
    if (!taken.has(withParent)) {
      return withParent
    }
  }
  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${String(suffix)}`
    const candidate = `${truncateSlug(base, 200 - ending.length)}${ending}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/** The ids of a term's ancestors, from its parent up. Stops after 10 000 levels. */
export async function termAncestorIds(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive chain(id, parent_id, depth) as (
      select id, parent_id, 0 from term where id = ${id}
      union all
      select t.id, t.parent_id, chain.depth + 1 from term t join chain on t.id = chain.parent_id where chain.depth < 10000
    )
    select id from chain where depth > 0`)
  return result.rows.map((row) => row.id)
}

export interface TermValues {
  readonly name: string
  readonly slug: string
  readonly parentId: string | null
  readonly description: string
}

export async function insertTerm(db: Executor, taxonomyId: string, values: TermValues, at: Date): Promise<string> {
  const [row] = await db
    .insert(term)
    .values({ taxonomyId, ...values, createdAt: at, modifiedAt: at })
    .returning({ id: term.id })
  if (row === undefined) {
    throw new Error('insert into term returned no row')
  }
  return row.id
}

export async function updateTerm(db: Executor, id: string, values: Partial<TermValues>, at: Date): Promise<void> {
  await db
    .update(term)
    .set({ ...values, modifiedAt: at })
    .where(eq(term.id, id))
}

/**
 * Deletes a term as WordPress' `wp_delete_term()` does: its children move up to its parent, the items lose the term, and a post left
 * without any category gets the default one («Ukategorisert»). A post that has another category keeps only that one.
 */
export async function deleteTermMovingItems(
  db: Executor,
  deleted: { readonly id: string; readonly taxonomyId: string; readonly parentId: string | null },
  defaultTermId: string | null,
  at: Date,
): Promise<void> {
  await db.update(term).set({ parentId: deleted.parentId, modifiedAt: at }).where(eq(term.parentId, deleted.id))
  const items = await db
    .select({ contentId: contentTerm.contentId })
    .from(contentTerm)
    .where(eq(contentTerm.termId, deleted.id))
  await db.delete(term).where(eq(term.id, deleted.id))
  if (defaultTermId !== null && items.length > 0) {
    // Only posts that have no term of this taxonomy left: the default category, as WordPress gives it.
    await db.execute(sql`insert into content_term (content_id, term_id, sort, created_at)
      select c.id, ${defaultTermId}, 0, ${at} from content c
      where c.id in (${sql.join(
        items.map((item) => sql`${item.contentId}`),
        sql`, `,
      )})
        and c.type = 'post'
        and not exists (select 1 from content_term ct join term t on t.id = ct.term_id
                        where ct.content_id = c.id and t.taxonomy_id = ${deleted.taxonomyId})
      on conflict do nothing`)
  }
}

export interface ContentTermRow {
  readonly contentId: string
  readonly taxonomy: string
  readonly id: string
  readonly name: string
  readonly slug: string
}

/** The terms of these items, by item: categories by name, tags in their order. */
export async function termsOfContent(
  db: Executor,
  contentIds: readonly string[],
): Promise<Map<string, { categories: ContentTermRow[]; tags: ContentTermRow[] }>> {
  const found = new Map<string, { categories: ContentTermRow[]; tags: ContentTermRow[] }>()
  if (contentIds.length === 0) {
    return found
  }
  const rows = await db
    .select({
      contentId: contentTerm.contentId,
      taxonomy: taxonomy.slug,
      id: term.id,
      name: term.name,
      slug: term.slug,
    })
    .from(contentTerm)
    .innerJoin(term, eq(term.id, contentTerm.termId))
    .innerJoin(taxonomy, eq(taxonomy.id, term.taxonomyId))
    .where(inArray(contentTerm.contentId, [...contentIds]))
    .orderBy(contentTerm.contentId, contentTerm.sort, sql`lower(${term.name})`)
  for (const row of rows) {
    const entry = found.get(row.contentId) ?? { categories: [], tags: [] }
    if (row.taxonomy === 'category') {
      entry.categories.push(row)
    } else if (row.taxonomy === 'post_tag') {
      entry.tags.push(row)
    }
    found.set(row.contentId, entry)
  }
  for (const entry of found.values()) {
    entry.categories.sort((a, b) => a.name.localeCompare(b.name))
  }
  return found
}

/** The ids among `ids` that are terms of the taxonomy. */
export async function existingTermIds(db: Executor, taxonomyId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set()
  }
  const rows = await db
    .select({ id: term.id })
    .from(term)
    .where(and(eq(term.taxonomyId, taxonomyId), inArray(term.id, [...ids])))
  return new Set(rows.map((row) => row.id))
}

/** The terms of one taxonomy an item has, in their order. */
export async function itemTermIds(db: Executor, contentId: string, taxonomyId: string): Promise<string[]> {
  const rows = await db
    .select({ id: term.id })
    .from(contentTerm)
    .innerJoin(term, eq(term.id, contentTerm.termId))
    .where(and(eq(contentTerm.contentId, contentId), eq(term.taxonomyId, taxonomyId)))
    .orderBy(contentTerm.sort, term.id)
  return rows.map((row) => row.id)
}

/** Replaces the terms of one taxonomy on an item, in order. */
export async function replaceItemTerms(
  db: Executor,
  contentId: string,
  taxonomyId: string,
  termIds: readonly string[],
  at: Date,
): Promise<void> {
  await db.execute(sql`delete from content_term ct using term t
    where ct.term_id = t.id and ct.content_id = ${contentId} and t.taxonomy_id = ${taxonomyId}`)
  if (termIds.length > 0) {
    await db.insert(contentTerm).values(termIds.map((termId, sort) => ({ contentId, termId, sort, createdAt: at })))
  }
}

/** The ids of tags with these names (without regard to case), making the ones that do not exist yet. Take `lockTaxonomy` first. */
export async function ensureTags(
  db: Executor,
  taxonomyId: string,
  names: readonly string[],
  slugOf: (name: string) => string,
  at: Date,
): Promise<string[]> {
  if (names.length === 0) {
    return []
  }
  const rows = await db
    .select({ id: term.id, name: term.name })
    .from(term)
    .where(
      and(
        eq(term.taxonomyId, taxonomyId),
        inArray(
          sql`lower(${term.name})`,
          names.map((name) => name.toLowerCase()),
        ),
      ),
    )
  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row.id]))
  const ids: string[] = []
  for (const name of names) {
    let id = byName.get(name.toLowerCase())
    if (id === undefined) {
      const slug = await uniqueTermSlug(db, taxonomyId, slugOf(name), null, null)
      id = await insertTerm(db, taxonomyId, { name, slug, parentId: null, description: '' }, at)
      byName.set(name.toLowerCase(), id)
    }
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }
  return ids
}

/** The term and every term below it (for «posts in this category», which WordPress' `cat` includes). */
export async function termWithDescendants(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive tree(id, depth) as (
      select id, 0 from term where id = ${id}
      union all
      select t.id, tree.depth + 1 from term t join tree on t.parent_id = tree.id where tree.depth < 10000
    )
    select id from tree`)
  return result.rows.map((row) => row.id)
}
