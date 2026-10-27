// The registry behind the admin's left menu (M0.5, PLAN «Admin-opplevelsen»). Code registers items into it: core at start-up
// (CORE_MENU_ITEMS), extensions later (phase 1) through the same `register()`. Nothing about who sees what is hard-coded in the
// filter: an item carries its `capability` and, where WordPress shows it only to those without a capability, `unlessCapability`.
import { AdminMenuItem } from '@toascribe/shared'
import type { AdminMenuChild, AdminMenuEntry, AdminMenuItemInput } from '@toascribe/shared'

/**
 * The items of M0.5, M1.1 and M1.2, with WordPress' positions (wp-admin/menu.php). Only what works is here: «Oppdateringer», the users' «Legg til ny» and
 * «Roller» are added by the task that builds them. The icons are Lucide names; the admin lists them in `icon.clientBundle`.
 */
export const CORE_MENU_ITEMS: readonly AdminMenuItemInput[] = [
  {
    id: 'dashboard',
    labelKey: 'menu.dashboard',
    icon: 'i-lucide-gauge',
    position: 2,
    capability: 'read',
    to: '/',
    children: [{ id: 'dashboard.home', labelKey: 'menu.dashboardHome', capability: 'read', to: '/' }],
  },
  {
    // WordPress' «Innlegg» (menu.php position 5; the dashicon is a pin).
    id: 'posts',
    labelKey: 'menu.posts',
    icon: 'i-lucide-pin',
    position: 5,
    capability: 'edit_posts',
    to: '/posts',
    children: [
      { id: 'posts.all', labelKey: 'menu.postsAll', capability: 'edit_posts', to: '/posts' },
      { id: 'posts.new', labelKey: 'menu.postsNew', capability: 'edit_posts', to: '/posts/new' },
      // WordPress shows Kategorier and Stikkord to those who may manage terms (`manage_categories`).
      { id: 'posts.categories', labelKey: 'menu.postsCategories', capability: 'manage_categories', to: '/categories' },
      { id: 'posts.tags', labelKey: 'menu.postsTags', capability: 'manage_categories', to: '/tags' },
    ],
  },
  {
    // WordPress' «Media» (position 10): the library and «Legg til ny», for those who may upload (M1.2).
    id: 'media',
    labelKey: 'menu.media',
    icon: 'i-lucide-image',
    position: 10,
    capability: 'upload_files',
    to: '/media',
    children: [
      { id: 'media.library', labelKey: 'menu.mediaLibrary', capability: 'upload_files', to: '/media' },
      { id: 'media.new', labelKey: 'menu.mediaNew', capability: 'upload_files', to: '/media/new' },
    ],
  },
  {
    // WordPress' «Sider» (position 20).
    id: 'pages',
    labelKey: 'menu.pages',
    icon: 'i-lucide-file-text',
    position: 20,
    capability: 'edit_pages',
    to: '/pages',
    children: [
      { id: 'pages.all', labelKey: 'menu.pagesAll', capability: 'edit_pages', to: '/pages' },
      { id: 'pages.new', labelKey: 'menu.pagesNew', capability: 'edit_pages', to: '/pages/new' },
    ],
  },
  {
    id: 'users',
    labelKey: 'menu.users',
    icon: 'i-lucide-users',
    position: 70,
    capability: 'list_users',
    to: '/users',
    children: [
      { id: 'users.all', labelKey: 'menu.usersAll', capability: 'list_users', to: '/users' },
      { id: 'users.profile', labelKey: 'menu.usersProfile', capability: 'read', to: '/profile' },
    ],
  },
  {
    // WordPress' «Innstillinger» (position 80), in its order. «Diskusjon» comes with the comments (phase 3).
    id: 'settings',
    labelKey: 'menu.settings',
    icon: 'i-lucide-settings',
    position: 80,
    capability: 'manage_options',
    to: '/settings/general',
    children: [
      {
        id: 'settings.general',
        labelKey: 'menu.settingsGeneral',
        capability: 'manage_options',
        to: '/settings/general',
      },
      {
        id: 'settings.writing',
        labelKey: 'menu.settingsWriting',
        capability: 'manage_options',
        to: '/settings/writing',
      },
      {
        id: 'settings.reading',
        labelKey: 'menu.settingsReading',
        capability: 'manage_options',
        to: '/settings/reading',
      },
      { id: 'settings.media', labelKey: 'menu.settingsMedia', capability: 'manage_options', to: '/settings/media' },
      {
        id: 'settings.permalinks',
        labelKey: 'menu.settingsPermalinks',
        capability: 'manage_options',
        to: '/settings/permalinks',
      },
      {
        id: 'settings.privacy',
        labelKey: 'menu.settingsPrivacy',
        capability: 'manage_options',
        to: '/settings/privacy',
      },
    ],
  },
  {
    // WordPress shows «Profil» as a top-level item, in the place of «Brukere», to accounts that cannot list users.
    id: 'profile',
    labelKey: 'menu.profile',
    icon: 'i-lucide-user',
    position: 70,
    capability: 'read',
    unlessCapability: 'list_users',
    to: '/profile',
  },
]

export interface AdminMenuRegistry {
  /**
   * Adds an item. Throws when it does not fit `AdminMenuItem` or when its id, or the id of one of its children, is taken. The
   * message names the fields, never the values.
   */
  register: (item: AdminMenuItemInput) => void
  /** The items an account holding exactly these capabilities may see: filtered, sorted by position, in a fresh array. */
  forCapabilities: (capabilities: ReadonlySet<string>) => AdminMenuEntry[]
}

/** Shown when the capability rules let the account see it. */
function visible(rule: Pick<AdminMenuChild, 'capability' | 'unlessCapability'>, held: ReadonlySet<string>): boolean {
  return held.has(rule.capability) && (rule.unlessCapability === undefined || !held.has(rule.unlessCapability))
}

export function createAdminMenuRegistry(): AdminMenuRegistry {
  const items: AdminMenuItem[] = []
  const ids = new Set<string>()

  return {
    register(input) {
      const parsed = AdminMenuItem.safeParse(input)
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(item)'))]
        throw new Error(`invalid admin menu item: ${fields.join(', ')}`)
      }
      const item = parsed.data
      const own = [item.id, ...item.children.map((child) => child.id)]
      const taken = own.find((id, index) => ids.has(id) || own.indexOf(id) !== index)
      if (taken !== undefined) {
        throw new Error(`admin menu id already registered: ${taken}`)
      }
      for (const id of own) {
        ids.add(id)
      }
      items.push(item)
    },

    forCapabilities(held) {
      const shown: AdminMenuEntry[] = []
      for (const item of items) {
        if (!visible(item, held)) {
          continue
        }
        const children = item.children
          .filter((child) => visible(child, held))
          .map((child) => ({
            id: child.id,
            labelKey: child.labelKey,
            ...(child.icon === undefined ? {} : { icon: child.icon }),
            to: child.to,
          }))
        // An item that has sub-items but may show none of them is left out; one without any (a top-level link) stays.
        if (item.children.length > 0 && children.length === 0) {
          continue
        }
        shown.push({
          id: item.id,
          labelKey: item.labelKey,
          icon: item.icon,
          position: item.position,
          to: item.to,
          children,
        })
      }
      // `sort` is stable: items with the same position keep the order they were registered in.
      return shown.sort((a, b) => a.position - b.position)
    },
  }
}

/** A registry with the core items in it. */
export function createCoreAdminMenu(): AdminMenuRegistry {
  const registry = createAdminMenuRegistry()
  for (const item of CORE_MENU_ITEMS) {
    registry.register(item)
  }
  return registry
}
