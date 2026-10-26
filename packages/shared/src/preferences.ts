import { z } from 'zod'

// account.preferences (K-032 to K-040), the fields M0.5 uses. The column is open JSON: a later version may add keys, and
// they are kept. Reading fills in the default for a key that is missing or does not fit; writing merges the keys that were sent.

/**
 * The admin colour schemes. The api only stores the key; the admin maps each to Nuxt UI colours and light or dark
 * (WordPress' «Fargeskjema for administrasjonen»).
 */
export const ADMIN_COLOR_SCHEMES = ['default', 'light', 'midnight', 'ocean'] as const
export const AdminColorScheme = z.enum(ADMIN_COLOR_SCHEMES)
export type AdminColorScheme = z.infer<typeof AdminColorScheme>

/** The columns of a content list that «Skjermalternativer» can hide (K-037). The title is always shown. */
export const CONTENT_LIST_COLUMNS = ['author', 'categories', 'tags', 'date'] as const
export const ContentListColumn = z.enum(CONTENT_LIST_COLUMNS)
export type ContentListColumn = z.infer<typeof ContentListColumn>

/** «Skjermalternativer» of one list screen (WordPress' `manageedit-postcolumnshidden` and `edit_post_per_page`). */
export const ListScreenOptions = z.strictObject({
  hiddenColumns: z.array(ContentListColumn).max(CONTENT_LIST_COLUMNS.length),
  /** WordPress' default is 20; the API gives at most 100 a page. */
  perPage: z.int().min(1).max(100),
})
export type ListScreenOptions = z.infer<typeof ListScreenOptions>

export const DEFAULT_LIST_SCREEN_OPTIONS: ListScreenOptions = { hiddenColumns: [], perPage: 20 }

/** The preferences of an account, every key filled in. */
export const Preferences = z.object({
  adminColorScheme: AdminColorScheme,
  /** WordPress' «Vis verktøylinjen når du ser på nettstedet». Stored now; the site toolbar comes later. */
  showToolbarOnSite: z.boolean(),
  /** The dashboard's welcome panel has been dismissed («Avvis»). */
  dismissedWelcome: z.boolean(),
  /** «Skjermalternativer» of «Alle innlegg». */
  postsScreen: ListScreenOptions,
  /** «Skjermalternativer» of «Alle sider». */
  pagesScreen: ListScreenOptions,
})
export type Preferences = z.infer<typeof Preferences>

/** What an account that never saved a preference has. */
export const DEFAULT_PREFERENCES: Preferences = {
  adminColorScheme: 'default',
  showToolbarOnSite: true,
  dismissedWelcome: false,
  postsScreen: DEFAULT_LIST_SCREEN_OPTIONS,
  pagesScreen: DEFAULT_LIST_SCREEN_OPTIONS,
}

/** PATCH /me/preferences: any of the preferences, at least one. An unknown key or value is a 400. */
export const UpdatePreferencesRequest = z
  .strictObject({
    adminColorScheme: Preferences.shape.adminColorScheme,
    showToolbarOnSite: Preferences.shape.showToolbarOnSite,
    dismissedWelcome: Preferences.shape.dismissedWelcome,
    postsScreen: Preferences.shape.postsScreen,
    pagesScreen: Preferences.shape.pagesScreen,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>
