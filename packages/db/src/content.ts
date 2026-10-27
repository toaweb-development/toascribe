// What the api and the worker both do to content rows (M1.1): find a free slug the way WordPress' `wp_unique_post_slug()` does,
// and delete an item for good the way `wp_delete_post()` does (its children move up to its parent first). The api calls these
// from the content service, the worker from the daily trash purge. Run them inside a transaction: the slug lock is held to its end.
import { MenuItems, truncateSlug } from '@toascribe/shared'
import type { MenuItem } from '@toascribe/shared'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { DbExecutor } from './executor.ts'
import { content } from './schema/content.ts'
import { menu } from './schema/site.ts'
import { cacheInvalidation } from './schema/system.ts'

/** WordPress' `get_default_feed()` names and `embed`: a slug that is one of them gets a number (they are URL endpoints). */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(['feed', 'rdf', 'rss', 'rss2', 'atom', 'embed'])

/** Content types whose items have a parent and are reached by a path of slugs (pages). */
export const HIERARCHICAL_TYPES: ReadonlySet<string> = new Set(['page'])

export interface SlugScope {
  readonly type: string
  readonly locale: string
  readonly parentId: string | null
}

/** True when the slug cannot be used as it is (WordPress' «bad flat slug» and «bad hierarchical slug»). */
export function isReservedSlug(slug: string, type: string): boolean {
  if (RESERVED_SLUGS.has(slug)) {
    return true
  }
  // A page called `2` or `page2` would hide the second page of its parent's listing.
  return HIERARCHICAL_TYPES.has(type) && /^(page)?\d+$/.test(slug)
}

function scopeCondition(scope: SlugScope): SQL {
  const parent = scope.parentId === null ? isNull(content.parentId) : eq(content.parentId, scope.parentId)
  return and(eq(content.type, scope.type), eq(content.locale, scope.locale), parent) ?? sql`false`
}

/**
 * Serialises the choice of a slug in one scope (type, language, parent) until the end of the transaction, so two saves at once
 * cannot both take the same free slug and have one of them fail on the unique constraint.
 */
export async function lockSlugScope<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  scope: SlugScope,
): Promise<void> {
  const key = `toascribe:content-slug:${scope.type}:${scope.locale}:${scope.parentId ?? ''}`
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

/**
 * A slug no other item in the scope has: the slug itself, or the first of `slug-2`, `slug-3`, ... that is free (WordPress'
 * `wp_unique_post_slug()`, the slug cut so the number fits in 200 characters). Trashed items count, with their `__trashed` slug.
 * `excludeId` is the item being saved. Takes the scope's lock first (see `lockSlugScope`).
 */
export async function uniqueContentSlug<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  scope: SlugScope,
  slug: string,
  excludeId: string | null = null,
): Promise<string> {
  await lockSlugScope(db, scope)
  const base = truncateSlug(slug)
  // Every slug in the scope that starts like the candidates, in one query. The longest number WordPress could need cuts the
  // base by a few characters, so the shortest prefix any candidate has is used.
  const prefix = truncateSlug(base, 180)
  const rows = await db
    .select({ slug: content.slug })
    .from(content)
    .where(
      and(
        scopeCondition(scope),
        sql`starts_with(${content.slug}, ${prefix})`,
        excludeId === null ? undefined : ne(content.id, excludeId),
      ),
    )
  const taken = new Set(rows.map((row) => row.slug))
  if (!taken.has(base) && !isReservedSlug(base, scope.type)) {
    return base
  }
  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${String(suffix)}`
    const candidate = `${truncateSlug(base, 200 - ending.length)}${ending}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

export interface DeletedContent {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly slug: string
}

/**
 * Deletes an item for good. Its children first move to its own parent (or to the top), each with a slug that is free there, as
 * `wp_delete_post()` does; the foreign key's SET NULL is only the fallback. Authors, revisions, drafts, comments and references go
 * with it (ON DELETE CASCADE); media attached to it stay, unattached. Returns what was deleted, or undefined when it did not exist.
 */
export async function deleteContentPermanently<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  id: string,
): Promise<DeletedContent | undefined> {
  const [item] = await db
    .select({
      id: content.id,
      type: content.type,
      locale: content.locale,
      parentId: content.parentId,
      title: content.title,
      slug: content.slug,
    })
    .from(content)
    .where(eq(content.id, id))
    .for('update')
  if (item === undefined) {
    return undefined
  }
  const children = await db
    .select({ id: content.id, type: content.type, locale: content.locale, slug: content.slug })
    .from(content)
    .where(eq(content.parentId, id))
    .orderBy(content.menuOrder, content.id)
    .for('update')
  for (const child of children) {
    const scope = { type: child.type, locale: child.locale, parentId: item.parentId }
    const slug = await uniqueContentSlug(db, scope, child.slug, child.id)
    await db.update(content).set({ parentId: item.parentId, slug }).where(eq(content.id, child.id))
  }
  await db.delete(content).where(eq(content.id, id))
  // Its menu items go with it (Tor, M1.5), whoever deletes it: the api, or the worker's purge of the trash.
  await removeFromMenus(db, id, new Date())
  return { id: item.id, type: item.type, title: item.title, slug: item.slug }
}

/**
 * Takes the items that name `objectId` out of every menu, in the caller's transaction, and clears the site's cached menus they were
 * in. The children of an item take its place. Used when content or a term is deleted for good.
 */
export async function removeFromMenus<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  objectId: string,
  at: Date,
): Promise<void> {
  const prune = (items: readonly MenuItem[]): MenuItem[] =>
    items.flatMap((item) => {
      const children = prune(item.children)
      return item.objectId === objectId ? children : [{ ...item, children }]
    })
  const count = (items: readonly MenuItem[]): number => items.reduce((sum, item) => sum + 1 + count(item.children), 0)
  for (const row of await db.select({ id: menu.id, items: menu.items }).from(menu)) {
    const parsed = MenuItems.safeParse(row.items)
    if (!parsed.success) continue
    const kept = prune(parsed.data)
    if (count(kept) === count(parsed.data)) continue
    await db.update(menu).set({ items: kept, modifiedAt: at }).where(eq(menu.id, row.id))
    await db.insert(cacheInvalidation).values([
      { tag: `menu:${row.id}`, changedAt: at },
      { tag: 'menus', changedAt: at },
    ])
  }
}

/**
 * The text of a block tree in WordPress' parsed form (`innerHTML`, `innerBlocks`), which the items of the install hold until the
 * data migration of M1.3. Tolerant: anything that does not look like a parsed block gives no text.
 */
export function legacyBlocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) {
    return ''
  }
  const pieces: string[] = []
  for (const block of blocks as unknown[]) {
    if (typeof block !== 'object' || block === null) {
      continue
    }
    const html: unknown = Reflect.get(block, 'innerHTML')
    if (typeof html === 'string') {
      pieces.push(htmlText(html))
    }
    pieces.push(legacyBlocksText(Reflect.get(block, 'innerBlocks')))
  }
  return pieces.filter((piece) => piece !== '').join(' ')
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Tags out, the common entities decoded, whitespace folded. Enough for a search vector; never used for display. */
function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith('#')) {
        const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
      }
      return ENTITIES[name.toLowerCase()] ?? match
    })
    .replace(/\s+/g, ' ')
    .trim()
}
