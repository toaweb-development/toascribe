// The queries of «Utseende» (M1.5): `menu` and `global_set`, and what a menu item names (content and terms, by id).
import { schema } from '@toascribe/db'
import type { Blocks, MenuItems } from '@toascribe/shared'
import { asc, eq, inArray, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { content, globalSet, menu, taxonomy, term } = schema

export interface MenuRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly items: MenuItems
}

const menuColumns = { id: menu.id, slug: menu.slug, name: menu.name, items: menu.items }

export function listMenus(db: Executor): Promise<MenuRow[]> {
  return db
    .select(menuColumns)
    .from(menu)
    .orderBy(asc(sql`lower(${menu.name})`))
}

export async function findMenu(
  db: Executor,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<MenuRow | undefined> {
  const query = db.select(menuColumns).from(menu).where(eq(menu.id, id)).limit(1)
  return (await (options.forUpdate === true ? query.for('update') : query))[0]
}

export async function menuSlugTaken(db: Executor, slug: string): Promise<boolean> {
  return (await db.select({ id: menu.id }).from(menu).where(eq(menu.slug, slug)).limit(1)).length > 0
}

export async function insertMenu(db: Executor, values: { slug: string; name: string }, at: Date): Promise<string> {
  const [row] = await db
    .insert(menu)
    .values({ ...values, items: [], createdAt: at, modifiedAt: at })
    .returning({ id: menu.id })
  if (row === undefined) throw new Error('insert into menu returned nothing')
  return row.id
}

export async function updateMenu(
  db: Executor,
  id: string,
  values: { name?: string; items?: MenuItems },
  at: Date,
): Promise<void> {
  await db
    .update(menu)
    .set({ ...values, modifiedAt: at })
    .where(eq(menu.id, id))
}

export async function deleteMenu(db: Executor, id: string): Promise<void> {
  await db.delete(menu).where(eq(menu.id, id))
}

/** What items can name, by id: content (any status but the trash, with its type and whether it is published) and terms. */
export interface NamedObject {
  readonly id: string
  readonly kind: 'page' | 'post' | 'category' | 'post_tag'
  readonly title: string
  readonly published: boolean
}

export async function namedObjects(db: Executor, ids: readonly string[]): Promise<Map<string, NamedObject>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const [items, terms] = await Promise.all([
    db
      .select({ id: content.id, type: content.type, title: content.title, status: content.status })
      .from(content)
      .where(inArray(content.id, unique)),
    db
      .select({ id: term.id, name: term.name, taxonomy: taxonomy.slug })
      .from(term)
      .innerJoin(taxonomy, eq(taxonomy.id, term.taxonomyId))
      .where(inArray(term.id, unique)),
  ])
  const found = new Map<string, NamedObject>()
  for (const row of items) {
    if (row.status === 'trash' || (row.type !== 'post' && row.type !== 'page')) continue
    found.set(row.id, { id: row.id, kind: row.type, title: row.title, published: row.status === 'publish' })
  }
  for (const row of terms) {
    if (row.taxonomy !== 'category' && row.taxonomy !== 'post_tag') continue
    found.set(row.id, { id: row.id, kind: row.taxonomy, title: row.name, published: true })
  }
  return found
}

/** The slugs of terms, by id. */
export async function termSlugs(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: term.id, slug: term.slug })
    .from(term)
    .where(inArray(term.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row.slug]))
}

// --- Global sets --------------------------------------------------------------------------------------------------------------

export interface GlobalSetRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly blocks: Blocks
  readonly modifiedAt: Date
}

const setColumns = {
  id: globalSet.id,
  slug: globalSet.key,
  name: globalSet.name,
  blocks: globalSet.blocks,
  modifiedAt: globalSet.modifiedAt,
}

export function listGlobalSets(db: Executor): Promise<GlobalSetRow[]> {
  return db
    .select(setColumns)
    .from(globalSet)
    .orderBy(asc(sql`lower(${globalSet.name})`))
}

export async function findGlobalSet(
  db: Executor,
  by: { id: string } | { slug: string },
  options: { forUpdate?: boolean } = {},
): Promise<GlobalSetRow | undefined> {
  const query = db
    .select(setColumns)
    .from(globalSet)
    .where('id' in by ? eq(globalSet.id, by.id) : eq(globalSet.key, by.slug))
    .limit(1)
  return (await (options.forUpdate === true ? query.for('update') : query))[0]
}

export async function insertGlobalSet(db: Executor, values: { slug: string; name: string }, at: Date): Promise<string> {
  const [row] = await db
    .insert(globalSet)
    .values({ key: values.slug, name: values.name, blocks: [], createdAt: at, modifiedAt: at })
    .returning({ id: globalSet.id })
  if (row === undefined) throw new Error('insert into global_set returned nothing')
  return row.id
}

export async function updateGlobalSet(
  db: Executor,
  id: string,
  values: { name?: string; blocks?: Blocks },
  at: Date,
): Promise<void> {
  await db
    .update(globalSet)
    .set({ ...values, modifiedAt: at })
    .where(eq(globalSet.id, id))
}

export async function deleteGlobalSet(db: Executor, id: string): Promise<void> {
  await db.delete(globalSet).where(eq(globalSet.id, id))
}
