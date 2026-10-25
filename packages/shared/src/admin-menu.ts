import { z } from 'zod'

// The admin's left menu (M0.5; PLAN «Admin-opplevelsen»). It is built from a registry in the api, with WordPress' positions and
// icons (wp-admin/menu.php). Core registers its items at start-up and extensions add theirs later (phase 1) through the same
// `register()`, validated by `AdminMenuItem`. An item shows to an account that holds its `capability` (and, if it names one,
// does not hold `unlessCapability`). `GET /api/v1/admin/menu` returns the items the signed-in account may see.

/** A stable machine id: lower-case words joined by `-`, `_` or `.` (`dashboard`, `users.all`, `my-plugin.reports`). */
const menuId = z
  .string()
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/)

/** An admin i18n key (`menu.dashboard`), never screen text. */
const labelKey = z
  .string()
  .max(200)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/)

/** A Lucide icon as Nuxt Icon writes it. The admin bundles the icons it uses, so only this set is allowed. */
const lucideIcon = z
  .string()
  .max(100)
  .regex(/^i-lucide-[a-z0-9]+(-[a-z0-9]+)*$/)

/** A capability name: a core one, or one an extension adds (`manage_my_plugin`). */
const capabilityName = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)

/**
 * A path inside the admin, relative to its base (`/`, `/users`, `/profile`): starts with one `/`, no scheme or host, no query,
 * no `..` or empty segment. The admin adds `/admin` itself.
 */
export const AdminPath = z
  .string()
  .max(200)
  .regex(/^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*\/?)?$/)
  .refine((path) => !path.split('/').some((segment) => segment === '..' || segment === '.'), {
    message: 'Must not contain . or .. segments',
  })

const visibility = {
  /** The account needs this capability to see the item. */
  capability: capabilityName,
  /** Hides the item from accounts that hold this capability (WordPress shows «Profil» top-level only without `list_users`). */
  unlessCapability: capabilityName.optional(),
}

/** A sub-item. Its order is the order of the list. */
export const AdminMenuChild = z.strictObject({
  id: menuId,
  labelKey,
  icon: lucideIcon.optional(),
  to: AdminPath,
  ...visibility,
})
export type AdminMenuChild = z.infer<typeof AdminMenuChild>

/** What `register()` takes: a top-level item with its sub-items. */
export const AdminMenuItem = z.strictObject({
  id: menuId,
  labelKey,
  icon: lucideIcon,
  /** WordPress' menu position (Dashboard 2, Users 70, ...). A fraction is allowed, to slot in between two. */
  position: z.number().min(0).max(1000),
  to: AdminPath,
  ...visibility,
  children: z.array(AdminMenuChild).max(50).default([]),
})
/** The input of `register()`: `children` may be left out. */
export type AdminMenuItemInput = z.input<typeof AdminMenuItem>
export type AdminMenuItem = z.infer<typeof AdminMenuItem>

/** A sub-item as the admin gets it: the capability rules have been applied, so they are not repeated. */
export const AdminMenuEntryChild = z.object({
  id: z.string(),
  labelKey: z.string(),
  icon: z.string().optional(),
  to: z.string(),
})
export type AdminMenuEntryChild = z.infer<typeof AdminMenuEntryChild>

export const AdminMenuEntry = z.object({
  id: z.string(),
  labelKey: z.string(),
  icon: z.string(),
  position: z.number(),
  to: z.string(),
  children: z.array(AdminMenuEntryChild),
})
export type AdminMenuEntry = z.infer<typeof AdminMenuEntry>

/** GET /admin/menu: the items the account may see, sorted by `position` (equal positions in registration order). */
export const AdminMenuResponse = z.object({ items: z.array(AdminMenuEntry) })
export type AdminMenuResponse = z.infer<typeof AdminMenuResponse>
