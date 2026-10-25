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

/** The preferences of an account, every key filled in. */
export const Preferences = z.object({
  adminColorScheme: AdminColorScheme,
  /** WordPress' «Vis verktøylinjen når du ser på nettstedet». Stored now; the site toolbar comes later. */
  showToolbarOnSite: z.boolean(),
  /** The dashboard's welcome panel has been dismissed («Avvis»). */
  dismissedWelcome: z.boolean(),
})
export type Preferences = z.infer<typeof Preferences>

/** What an account that never saved a preference has. */
export const DEFAULT_PREFERENCES: Preferences = {
  adminColorScheme: 'default',
  showToolbarOnSite: true,
  dismissedWelcome: false,
}

/** PATCH /me/preferences: any of the preferences, at least one. An unknown key or value is a 400. */
export const UpdatePreferencesRequest = z
  .strictObject({
    adminColorScheme: Preferences.shape.adminColorScheme,
    showToolbarOnSite: Preferences.shape.showToolbarOnSite,
    dismissedWelcome: Preferences.shape.dismissedWelcome,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>
