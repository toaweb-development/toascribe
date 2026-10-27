// «Utseende → Menyer» and «Utseende → Globale sett» (M1.5, K-132, K-106), with `edit_theme_options`, and what the site reads of them.
//
// Menus: one JSON tree per menu (shared/menus.ts). An item that names content or a term keeps its id; the site gets the current title
// and address, and only published content (an item whose content is not published is left out, its children moved up to its place).
// When content or a term is deleted for good, its items are taken out of every menu (removeFromMenus).
//
// Global sets: named block documents for the whole site, checked against each block's block.json and the account's block rights as
// content is (a custom HTML block needs unfiltered_html). The site reads one by its slug.
import { documentMediaRefs, isSafeHref, permissionIssues, validateDocument } from '@toascribe/blocks'
import type { Block } from '@toascribe/blocks'
import type { Database } from '@toascribe/db'
import { CoreSettings, MenuItems, menuItemsOf, sanitizeTitle } from '@toascribe/shared'
import type {
  CreateGlobalSetRequest,
  CreateMenuRequest,
  GlobalSetDetail,
  GlobalSetListResponse,
  MenuDetail,
  MenuItem,
  MenuListResponse,
  MenuLocationsResponse,
  PublicGlobalSetResponse,
  PublicMenuItem,
  PublicMenuResponse,
  UpdateGlobalSetRequest,
  UpdateMenuLocationsRequest,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, ForbiddenError, InvalidBlocksError, NotFoundError } from '../lib/errors.ts'
import {
  deleteGlobalSet,
  deleteMenu,
  findGlobalSet,
  findMenu,
  insertGlobalSet,
  insertMenu,
  listGlobalSets,
  listMenus,
  menuSlugTaken,
  namedObjects,
  termSlugs,
  updateGlobalSet,
  updateMenu,
} from '../repositories/appearance.ts'
import type { Executor } from '../repositories/executor.ts'
import { inTransaction } from '../repositories/executor.ts'
import { findPublishedByIds, pagePaths, recordInvalidation } from '../repositories/public.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import type { MediaService } from './media.ts'
import { loadLinks } from './permalinks.ts'
import type { Auditor, RequestContext } from './support.ts'

const LOCATIONS = CoreSettings.pick({ menu_locations: true })
const FRONT = CoreSettings.pick({ show_on_front: true, page_on_front: true })
/** Nobody signed in: the media a visitor may see (public files only). */
const VISITOR = { id: '', capabilities: new Set<string>() } as const

export interface AppearanceService {
  menus(auth: SessionAuth): Promise<MenuListResponse>
  createMenu(auth: SessionAuth, request: CreateMenuRequest, ctx: RequestContext): Promise<MenuDetail>
  menu(auth: SessionAuth, id: string): Promise<MenuDetail>
  updateMenu(
    auth: SessionAuth,
    id: string,
    request: { readonly name?: string | undefined; readonly items?: readonly unknown[] | undefined },
    ctx: RequestContext,
  ): Promise<MenuDetail>
  deleteMenu(auth: SessionAuth, id: string, ctx: RequestContext): Promise<void>
  locations(auth: SessionAuth): Promise<MenuLocationsResponse>
  updateLocations(
    auth: SessionAuth,
    request: UpdateMenuLocationsRequest,
    ctx: RequestContext,
  ): Promise<MenuLocationsResponse>
  globalSets(auth: SessionAuth): Promise<GlobalSetListResponse>
  createGlobalSet(auth: SessionAuth, request: CreateGlobalSetRequest, ctx: RequestContext): Promise<GlobalSetDetail>
  globalSet(auth: SessionAuth, id: string): Promise<GlobalSetDetail>
  updateGlobalSet(
    auth: SessionAuth,
    id: string,
    request: UpdateGlobalSetRequest,
    ctx: RequestContext,
  ): Promise<GlobalSetDetail>
  deleteGlobalSet(auth: SessionAuth, id: string, ctx: RequestContext): Promise<void>
  /** The menu in a theme location, as the site draws it. */
  publicMenu(location: string): Promise<PublicMenuResponse>
  /** A global set as the site draws it; NotFoundError when there is none of that slug. */
  publicGlobalSet(slug: string): Promise<PublicGlobalSetResponse>
}

function slugOf(name: string): string {
  return (
    sanitizeTitle(name, '')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'meny'
  )
}

/** The items of a tree without the ones `drop` names; the children of a dropped item take its place. */
export function withoutItems(items: readonly MenuItem[], drop: (item: MenuItem) => boolean): MenuItem[] {
  return items.flatMap((item) => {
    const children = withoutItems(item.children, drop)
    return drop(item) ? children : [{ ...item, children }]
  })
}

/**
 * Takes the items that name `objectId` out of every menu (content or a term deleted for good: Tor, M1.5), in the caller's transaction.
 * The children of an item take its place.
 */
export async function removeFromMenus(tx: Executor, objectId: string, at: Date): Promise<void> {
  for (const row of await listMenus(tx)) {
    const items = MenuItems.catch([]).parse(row.items)
    const kept = withoutItems(items, (item) => item.objectId === objectId)
    if (menuItemsOf(kept).length !== menuItemsOf(items).length) {
      await updateMenu(tx, row.id, { items: kept }, at)
      await recordInvalidation(tx, [`menu:${row.id}`, 'menus'], at)
    }
  }
}

export function createAppearanceService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly media: Pick<MediaService, 'contentRefs'>
  readonly onInvalidSetting?: (key: string) => void
}): AppearanceService {
  const { db, clock, audit, media } = options

  function requireThemeOptions(auth: SessionAuth): void {
    if (!auth.capabilities.has('edit_theme_options')) throw new ForbiddenError()
  }
  const actorOf = (auth: SessionAuth) => ({ id: auth.account.id, username: auth.account.username })

  async function uniqueSlug(
    executor: Executor,
    name: string,
    taken: (slug: string) => Promise<boolean>,
  ): Promise<string> {
    const base = slugOf(name)
    for (let n = 1; n < 1000; n += 1) {
      const slug = n === 1 ? base : `${base}-${String(n)}`.slice(0, 64)
      if (!(await taken(slug))) return slug
    }
    void executor
    throw new AppError(409, 'slug_taken', 'No free slug for that name')
  }

  async function detail(id: string, executor: Executor = db): Promise<MenuDetail> {
    const row = await findMenu(executor, id)
    if (row === undefined) throw new NotFoundError()
    const items = MenuItems.parse(row.items)
    const objects = await namedObjects(
      executor,
      menuItemsOf(items).flatMap(({ item }) => (item.objectId === undefined ? [] : [item.objectId])),
    )
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      items,
      views: menuItemsOf(items).map(({ item }) => {
        const named = item.objectId === undefined ? undefined : objects.get(item.objectId)
        return {
          id: item.id,
          objectTitle: named?.title ?? null,
          shown: item.kind === 'custom' || (named !== undefined && named.kind === item.kind && named.published),
        }
      }),
    }
  }

  /** Each item names what it says: a link of one's own an address the site allows, content and terms one that exists. */
  async function checkItems(executor: Executor, items: readonly MenuItem[]): Promise<void> {
    const all = menuItemsOf(items).map(({ item }) => item)
    const objects = await namedObjects(
      executor,
      all.flatMap((item) => (item.objectId === undefined ? [] : [item.objectId])),
    )
    for (const item of all) {
      if (item.kind === 'custom') {
        if (item.url === undefined || !isSafeHref(item.url)) {
          throw new AppError(400, 'invalid_menu_item', `${item.id}: not an address a menu may link to`)
        }
      } else if (item.objectId === undefined || objects.get(item.objectId)?.kind !== item.kind) {
        throw new AppError(400, 'invalid_menu_item', `${item.id}: no such ${item.kind}`)
      }
    }
  }

  async function checkBlocks(auth: SessionAuth, blocks: readonly unknown[], previous: unknown): Promise<Block[]> {
    const checked = validateDocument(blocks)
    if (!checked.ok) throw new InvalidBlocksError(checked.issues.map((issue) => ({ ...issue, path: [...issue.path] })))
    const before = validateDocument(previous)
    const refused = permissionIssues(checked.blocks, before.ok ? before.blocks : [], {
      capabilities: auth.capabilities,
      contentType: 'global_set',
    })
    if (refused.length > 0) throw new InvalidBlocksError(refused.map((issue) => ({ ...issue, path: [...issue.path] })))
    return checked.blocks
  }

  async function setDetail(id: string, auth: SessionAuth | undefined): Promise<GlobalSetDetail> {
    const row = await findGlobalSet(db, { id })
    if (row === undefined) throw new NotFoundError()
    const checked = validateDocument(row.blocks)
    const blocks = checked.ok ? checked.blocks : []
    const mediaIds = [...new Set(documentMediaRefs(blocks).map((ref) => ref.mediaId))]
    const actor = auth === undefined ? VISITOR : { id: auth.account.id, capabilities: auth.capabilities }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      modifiedAt: row.modifiedAt.toISOString(),
      blocks: JSON.parse(JSON.stringify(blocks)) as Record<string, unknown>[],
      media: mediaIds.length === 0 ? [] : await media.contentRefs(actor, mediaIds),
    }
  }

  const service: AppearanceService = {
    async menus(auth) {
      requireThemeOptions(auth)
      const rows = await listMenus(db)
      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          count: menuItemsOf(MenuItems.catch([]).parse(row.items)).length,
        })),
      }
    },

    async createMenu(auth, request, ctx) {
      requireThemeOptions(auth)
      const id = await inTransaction(db, async (tx) => {
        const slug = await uniqueSlug(tx, request.name, (candidate) => menuSlugTaken(tx, candidate))
        const created = await insertMenu(tx, { slug, name: request.name }, clock())
        await audit(tx, ctx, { actor: actorOf(auth), action: 'menu.created', objectType: 'menu', objectId: created })
        return created
      })
      return detail(id)
    },

    async menu(auth, id) {
      requireThemeOptions(auth)
      return detail(id)
    },

    async updateMenu(auth, id, request, ctx) {
      requireThemeOptions(auth)
      await inTransaction(db, async (tx) => {
        const row = await findMenu(tx, id, { forUpdate: true })
        if (row === undefined) throw new NotFoundError()
        // The whole tree, checked here: the route's schema describes one level (OpenAPI cannot draw a recursive one).
        const parsed = request.items === undefined ? undefined : MenuItems.safeParse(request.items)
        if (parsed !== undefined && !parsed.success) {
          throw new AppError(400, 'invalid_menu_item', parsed.error.issues.map((issue) => issue.message).join('; '))
        }
        const items = parsed?.data
        if (items !== undefined) await checkItems(tx, items)
        await updateMenu(
          tx,
          id,
          {
            ...(request.name === undefined ? {} : { name: request.name }),
            ...(items === undefined ? {} : { items }),
          },
          clock(),
        )
        await audit(tx, ctx, {
          actor: actorOf(auth),
          action: 'menu.updated',
          objectType: 'menu',
          objectId: id,
          newValue: { fields: Object.keys(request).sort() },
        })
      })
      return detail(id)
    },

    async deleteMenu(auth, id, ctx) {
      requireThemeOptions(auth)
      await inTransaction(db, async (tx) => {
        const row = await findMenu(tx, id, { forUpdate: true })
        if (row === undefined) throw new NotFoundError()
        await deleteMenu(tx, id)
        // A location that showed it shows nothing now.
        const { menu_locations: locations } = await readSettings(tx, LOCATIONS)
        const kept = Object.fromEntries(
          Object.entries(locations).map(([slug, menuId]) => [slug, menuId === id ? null : menuId]),
        )
        await writeSettings(tx, { menu_locations: kept })
        await audit(tx, ctx, { actor: actorOf(auth), action: 'menu.deleted', objectType: 'menu', objectId: id })
      })
    },

    async locations(auth) {
      requireThemeOptions(auth)
      return { locations: (await readSettings(db, LOCATIONS, options.onInvalidSetting)).menu_locations }
    },

    async updateLocations(auth, request, ctx) {
      requireThemeOptions(auth)
      await inTransaction(db, async (tx) => {
        for (const menuId of Object.values(request.locations)) {
          if (menuId !== null && (await findMenu(tx, menuId)) === undefined) {
            throw new AppError(400, 'invalid_menu', 'No such menu')
          }
        }
        await writeSettings(tx, { menu_locations: request.locations })
        await audit(tx, ctx, {
          actor: actorOf(auth),
          action: 'menu_locations.updated',
          objectType: 'menu',
          newValue: { locations: Object.keys(request.locations).sort() },
        })
      })
      return service.locations(auth)
    },

    async globalSets(auth) {
      requireThemeOptions(auth)
      const rows = await listGlobalSets(db)
      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          modifiedAt: row.modifiedAt.toISOString(),
        })),
      }
    },

    async createGlobalSet(auth, request, ctx) {
      requireThemeOptions(auth)
      const id = await inTransaction(db, async (tx) => {
        if (request.slug !== undefined && (await findGlobalSet(tx, { slug: request.slug })) !== undefined) {
          throw new AppError(409, 'slug_taken', 'A global set with that slug already exists')
        }
        const slug =
          request.slug ??
          (await uniqueSlug(
            tx,
            request.name,
            async (candidate) => (await findGlobalSet(tx, { slug: candidate })) !== undefined,
          ))
        const created = await insertGlobalSet(tx, { slug, name: request.name }, clock())
        await audit(tx, ctx, {
          actor: actorOf(auth),
          action: 'global_set.created',
          objectType: 'global_set',
          objectId: created,
        })
        return created
      })
      return setDetail(id, auth)
    },

    async globalSet(auth, id) {
      requireThemeOptions(auth)
      return setDetail(id, auth)
    },

    async updateGlobalSet(auth, id, request, ctx) {
      requireThemeOptions(auth)
      await inTransaction(db, async (tx) => {
        const row = await findGlobalSet(tx, { id }, { forUpdate: true })
        if (row === undefined) throw new NotFoundError()
        const blocks = request.blocks === undefined ? undefined : await checkBlocks(auth, request.blocks, row.blocks)
        await updateGlobalSet(
          tx,
          id,
          {
            ...(request.name === undefined ? {} : { name: request.name }),
            ...(blocks === undefined ? {} : { blocks: JSON.parse(JSON.stringify(blocks)) as Record<string, never>[] }),
          },
          clock(),
        )
        await audit(tx, ctx, {
          actor: actorOf(auth),
          action: 'global_set.updated',
          objectType: 'global_set',
          objectId: id,
          newValue: { fields: Object.keys(request).sort() },
        })
      })
      return setDetail(id, auth)
    },

    async deleteGlobalSet(auth, id, ctx) {
      requireThemeOptions(auth)
      await inTransaction(db, async (tx) => {
        if ((await findGlobalSet(tx, { id }, { forUpdate: true })) === undefined) throw new NotFoundError()
        await deleteGlobalSet(tx, id)
        await audit(tx, ctx, {
          actor: actorOf(auth),
          action: 'global_set.deleted',
          objectType: 'global_set',
          objectId: id,
        })
      })
    },

    async publicMenu(location) {
      const { menu_locations: locations } = await readSettings(db, LOCATIONS, options.onInvalidSetting)
      const menuId = Object.hasOwn(locations, location) ? locations[location] : undefined
      const baseTags = ['menus', 'settings', 'list:post', 'list:page']
      const row = menuId === undefined || menuId === null ? undefined : await findMenu(db, menuId)
      if (row === undefined) return { location, name: null, items: [], cacheTags: baseTags }
      const items = MenuItems.catch([]).parse(row.items)
      const all = menuItemsOf(items).map(({ item }) => item)
      const objectIds = all.flatMap((item) => (item.objectId === undefined ? [] : [item.objectId]))
      const [objects, published, links, front] = await Promise.all([
        namedObjects(db, objectIds),
        findPublishedByIds(db, objectIds),
        loadLinks(db, options.onInvalidSetting),
        readSettings(db, FRONT, options.onInvalidSetting),
      ])
      const posts = published.filter((entry) => entry.type === 'post')
      const pages = published.filter((entry) => entry.type === 'page')
      const termIds = all
        .filter((item) => item.kind === 'category' && item.objectId !== undefined)
        .map((item) => item.objectId ?? '')
      const [postPaths, pageTree, categoryPaths] = await Promise.all([
        links.postPaths(posts),
        pagePaths(
          db,
          pages.map((entry) => entry.id),
        ),
        links.categoryPaths(termIds),
      ])
      const tagIds = all.filter((item) => item.kind === 'post_tag').map((item) => item.objectId ?? '')
      const tagPaths = new Map([...(await termSlugs(db, tagIds))].map(([id, slug]) => [id, links.tagPath(slug)]))
      const publishedIds = new Set(published.map((entry) => entry.id))
      const urlOf = (item: MenuItem): string | undefined => {
        if (item.kind === 'custom') return item.url
        const id = item.objectId ?? ''
        if (item.kind === 'post') return publishedIds.has(id) ? postPaths.get(id) : undefined
        if (item.kind === 'page') {
          if (!publishedIds.has(id)) return undefined
          return front.show_on_front === 'page' && front.page_on_front === id ? '/' : pageTree.get(id)?.path
        }
        if (item.kind === 'category') return categoryPaths.get(id)
        return tagPaths.get(id)
      }
      const shown = (list: readonly MenuItem[]): PublicMenuItem[] =>
        list.flatMap((item) => {
          const children = shown(item.children)
          const url = urlOf(item)
          // Not published (or gone): left out, and its children take its place.
          if (url === undefined) return children
          const named = item.objectId === undefined ? undefined : objects.get(item.objectId)
          return [
            {
              id: item.id,
              label: item.label.trim() === '' ? (named?.title ?? url) : item.label,
              url,
              newTab: item.newTab,
              cssClass: item.cssClass,
              description: item.description,
              objectId: item.objectId ?? null,
              children,
            },
          ]
        })
      return {
        location,
        name: row.name,
        items: shown(items),
        cacheTags: [
          ...baseTags,
          `menu:${row.id}`,
          ...objectIds.map((id) =>
            objects.get(id)?.kind === 'category' || objects.get(id)?.kind === 'post_tag'
              ? `term:${id}`
              : `content:${id}`,
          ),
        ],
      }
    },

    async publicGlobalSet(slug) {
      const row = await findGlobalSet(db, { slug })
      if (row === undefined) throw new NotFoundError()
      const found = await setDetail(row.id, undefined)
      return {
        slug: found.slug,
        name: found.name,
        blocks: found.blocks,
        media: found.media,
        cacheTags: [`global_set:${row.id}`, ...found.media.map((ref) => `media:${ref.id}`)],
      }
    },
  }
  return service
}
