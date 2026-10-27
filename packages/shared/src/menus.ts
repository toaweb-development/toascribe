// Menus and global sets (M1.5; PLAN «Admin-opplevelsen» Utseende, K-132, K-106).
//
// A menu is one JSON tree (Tor): each item is a page, a post, a category, a tag or a link of one's own, with WordPress' fields (label,
// «Åpne i ny fane», CSS class, description). An item that names content or a term stores its id only: the site shows the current
// title and address, so the item follows the content when its slug or title changes, and an item whose content is not published is
// not shown. Menus are placed in the locations of the active theme's `theme.json` (`menus`).
//
// A global set is a named collection of blocks for the whole site («Kontaktinfo», «Bunntekst»), edited with the block editor; a theme
// reads it with `useGlobalSet(slug)`, and the «Globalt sett» block shows one anywhere.
import { z } from 'zod'

import { ContentMediaRef } from './content.ts'

/** The most items a menu has, and how deep it goes (WordPress has no limit; these keep a menu something a person can use). */
export const MENU_MAX_ITEMS = 500
export const MENU_MAX_DEPTH = 10

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const Name = z.string().trim().min(1).max(200)

export const MENU_ITEM_KINDS = ['page', 'post', 'category', 'post_tag', 'custom'] as const
export const MenuItemKind = z.enum(MENU_ITEM_KINDS)
export type MenuItemKind = z.infer<typeof MenuItemKind>

/** One item as it is stored and edited. */
export interface MenuItem {
  readonly id: string
  readonly kind: MenuItemKind
  /** The content or term an item of those kinds names. */
  readonly objectId?: string | undefined
  /** The address of a link of one's own: http(s), mailto:, a path on the site or a fragment (the api checks it as a block's link). */
  readonly url?: string | undefined
  /** Empty: the content's or term's own title. */
  readonly label: string
  readonly newTab: boolean
  readonly cssClass: string
  readonly description: string
  readonly children: readonly MenuItem[]
}

export const MenuItem: z.ZodType<MenuItem> = z.lazy(() =>
  z.strictObject({
    id: z.string().regex(/^m_[A-Za-z0-9_-]{4,40}$/),
    kind: MenuItemKind,
    objectId: z.uuid().optional(),
    url: z.string().max(2000).optional(),
    label: z.string().max(200),
    newTab: z.boolean(),
    /** Class names only: letters, digits, - and _, separated by spaces. */
    cssClass: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_ -]*$/),
    description: z.string().max(500),
    children: z.array(MenuItem),
  }),
)

/** Every item of a tree, depth first, with its depth (0 at the top). */
export function menuItemsOf(items: readonly MenuItem[], depth = 0): { item: MenuItem; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...menuItemsOf(item.children, depth + 1)])
}

export const MenuItems = z.array(MenuItem).superRefine((items, ctx) => {
  const all = menuItemsOf(items)
  if (all.length > MENU_MAX_ITEMS) ctx.addIssue({ code: 'custom', message: `at most ${String(MENU_MAX_ITEMS)} items` })
  if (all.some((entry) => entry.depth >= MENU_MAX_DEPTH)) {
    ctx.addIssue({ code: 'custom', message: `at most ${String(MENU_MAX_DEPTH)} levels` })
  }
  if (new Set(all.map((entry) => entry.item.id)).size !== all.length) {
    ctx.addIssue({ code: 'custom', message: 'each item id once' })
  }
  for (const { item } of all) {
    const wantsObject = item.kind !== 'custom'
    if (wantsObject !== (item.objectId !== undefined) || wantsObject === (item.url !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `${item.id}: content and terms name an objectId, links of one's own a url`,
      })
    }
  }
})

export type MenuItems = z.infer<typeof MenuItems>

export const MenuSummary = z.object({ id: z.uuid(), slug: Slug, name: z.string(), count: z.int().min(0) })
export type MenuSummary = z.infer<typeof MenuSummary>

/** An item as the editor shows it: what it names now (title, address) and whether the site shows it. */
export const MenuItemView = z.object({
  id: z.string(),
  /** The current title of the content or term; null for a link of one's own, or when the object is gone. */
  objectTitle: z.string().nullable(),
  /** False when the object is not published (or gone): the site leaves the item out. */
  shown: z.boolean(),
})

export const MenuDetail = z.object({
  id: z.uuid(),
  slug: Slug,
  name: z.string(),
  items: MenuItems,
  /** By item id: what the editor shows next to each item. */
  views: z.array(MenuItemView),
})
export type MenuDetail = z.infer<typeof MenuDetail>

export const MenuListResponse = z.object({ items: z.array(MenuSummary) })
export type MenuListResponse = z.infer<typeof MenuListResponse>

export const CreateMenuRequest = z.strictObject({ name: Name })
export type CreateMenuRequest = z.infer<typeof CreateMenuRequest>
export const UpdateMenuRequest = z
  .strictObject({ name: Name, items: MenuItems })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateMenuRequest = z.infer<typeof UpdateMenuRequest>

/** Where the menus stand: a theme location's slug (`primary`) → a menu, or null for none. */
export const MenuLocations = z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), z.uuid().nullable())
export type MenuLocations = z.infer<typeof MenuLocations>
export const MenuLocationsResponse = z.object({ locations: MenuLocations })
export type MenuLocationsResponse = z.infer<typeof MenuLocationsResponse>
export const UpdateMenuLocationsRequest = z.strictObject({ locations: MenuLocations })
export type UpdateMenuLocationsRequest = z.infer<typeof UpdateMenuLocationsRequest>

/** A menu item as the site draws it: the address and title now, published content only. */
export interface PublicMenuItem {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly newTab: boolean
  readonly cssClass: string
  readonly description: string
  /** The item is the page being shown, or above it: themes mark it (WordPress' current-menu-item / -ancestor). */
  readonly objectId: string | null
  readonly children: readonly PublicMenuItem[]
}
export const PublicMenuItem: z.ZodType<PublicMenuItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    url: z.string(),
    newTab: z.boolean(),
    cssClass: z.string(),
    description: z.string(),
    objectId: z.string().nullable(),
    children: z.array(PublicMenuItem),
  }),
)
export const PublicMenuResponse = z.object({
  location: z.string(),
  name: z.string().nullable(),
  items: z.array(PublicMenuItem),
  cacheTags: z.array(z.string()),
})
export type PublicMenuResponse = z.infer<typeof PublicMenuResponse>

// ── Global sets (K-106) ──────────────────────────────────────

export const GlobalSetSummary = z.object({
  id: z.uuid(),
  slug: Slug,
  name: z.string(),
  modifiedAt: z.iso.datetime({ offset: true }),
})
export type GlobalSetSummary = z.infer<typeof GlobalSetSummary>
export const GlobalSetDetail = GlobalSetSummary.extend({
  blocks: z.array(z.record(z.string(), z.unknown())),
  media: z.array(ContentMediaRef),
})
export type GlobalSetDetail = z.infer<typeof GlobalSetDetail>
export const GlobalSetListResponse = z.object({ items: z.array(GlobalSetSummary) })
export type GlobalSetListResponse = z.infer<typeof GlobalSetListResponse>
/** GET /global-sets/choices: the sets the «Globalt sett» block may name. */
export const GlobalSetChoicesResponse = z.object({ items: z.array(z.object({ slug: Slug, name: z.string() })) })
export type GlobalSetChoicesResponse = z.infer<typeof GlobalSetChoicesResponse>

export const CreateGlobalSetRequest = z.strictObject({ name: Name, slug: Slug.optional() })
export type CreateGlobalSetRequest = z.infer<typeof CreateGlobalSetRequest>
export const UpdateGlobalSetRequest = z
  .strictObject({ name: Name, blocks: z.array(z.unknown()).max(500) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateGlobalSetRequest = z.infer<typeof UpdateGlobalSetRequest>
export const PublicGlobalSetResponse = z.object({
  /** False when there is no set of the slug (a theme asks for its own before it is made): no blocks, and tags that clear it. */
  found: z.boolean(),
  slug: Slug,
  name: z.string(),
  blocks: z.array(z.record(z.string(), z.unknown())),
  media: z.array(ContentMediaRef),
  cacheTags: z.array(z.string()),
})
export type PublicGlobalSetResponse = z.infer<typeof PublicGlobalSetResponse>
