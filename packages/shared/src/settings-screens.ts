// The settings screens of M1.5 (PLAN «Innstillinger, verktøy, utseende og personvern», K-190 to K-194, K-198): one group per
// WordPress screen, read and written with `GET/PATCH /settings/{group}` and `manage_options`. Each group is a pick of CoreSettings,
// with the fields in WordPress' order; an answer adds what the screen shows but cannot change.
import { z } from 'zod'

import { CoreSettings } from './settings.ts'

/** An id in a request, lower-cased: PostgreSQL reads `ABC…` and `abc…` as the same uuid, and the site compares them as text. */
const id = z.uuid().transform((value) => value.toLowerCase())

/** «Innstillinger → Generelt» (K-191). The administrator's address is changed through a confirmation (K-192), not here. */
export const GeneralSettings = CoreSettings.pick({
  blogname: true,
  blogdescription: true,
  admin_email: true,
  users_can_register: true,
  default_role: true,
  locale: true,
  timezone_string: true,
  gmt_offset: true,
  date_format: true,
  time_format: true,
  start_of_week: true,
})
export type GeneralSettings = z.infer<typeof GeneralSettings>

export const GeneralSettingsResponse = z.object({
  settings: GeneralSettings,
  /** The site's address (PUBLIC_ORIGIN): shown, not set here. */
  siteUrl: z.string(),
  /** An address waiting for its confirmation, if any (K-192). */
  pendingAdminEmail: z.email().nullable(),
  /** The languages the site can be shown in. */
  locales: z.array(z.object({ code: z.string(), name: z.string() })),
})
export type GeneralSettingsResponse = z.infer<typeof GeneralSettingsResponse>

export const UpdateGeneralSettingsRequest = GeneralSettings.omit({ admin_email: true })
  .partial()
  .extend({
    /** A new administrator address: mailed a link, and used once it is opened (K-192). */
    new_admin_email: z.email().max(254).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateGeneralSettingsRequest = z.infer<typeof UpdateGeneralSettingsRequest>

/** POST /settings/general/admin-email/confirm: the token of the link sent to the new address. */
export const ConfirmAdminEmailRequest = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
export const ConfirmAdminEmailResponse = z.object({ adminEmail: z.email() })
export type ConfirmAdminEmailResponse = z.infer<typeof ConfirmAdminEmailResponse>

/** «Innstillinger → Skriving» (K-193). Post by e-mail and update services are left out (PLAN). */
export const WritingSettings = CoreSettings.pick({ default_category: true, default_post_format: true })
export type WritingSettings = z.infer<typeof WritingSettings>
export const WritingSettingsResponse = z.object({ settings: WritingSettings })
export type WritingSettingsResponse = z.infer<typeof WritingSettingsResponse>
export const UpdateWritingSettingsRequest = WritingSettings.extend({ default_category: id.nullable() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateWritingSettingsRequest = z.infer<typeof UpdateWritingSettingsRequest>

/** «Innstillinger → Lesing» (K-194, K-226). */
export const ReadingSettings = CoreSettings.pick({
  show_on_front: true,
  page_on_front: true,
  page_for_posts: true,
  posts_per_page: true,
  posts_per_rss: true,
  rss_use_excerpt: true,
  blog_public: true,
})
export type ReadingSettings = z.infer<typeof ReadingSettings>
export const ReadingSettingsResponse = z.object({ settings: ReadingSettings })
export type ReadingSettingsResponse = z.infer<typeof ReadingSettingsResponse>
export const UpdateReadingSettingsRequest = ReadingSettings.extend({
  page_on_front: id.nullable(),
  page_for_posts: id.nullable(),
  posts_per_page: z.int().min(1).max(100),
  posts_per_rss: z.int().min(1).max(100),
})
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateReadingSettingsRequest = z.infer<typeof UpdateReadingSettingsRequest>

/** «Innstillinger → Personvern» (K-198). */
export const PrivacySettings = CoreSettings.pick({ wp_page_for_privacy_policy: true })
export type PrivacySettings = z.infer<typeof PrivacySettings>
export const PrivacySettingsResponse = z.object({ settings: PrivacySettings })
export type PrivacySettingsResponse = z.infer<typeof PrivacySettingsResponse>
export const UpdatePrivacySettingsRequest = PrivacySettings.extend({ wp_page_for_privacy_policy: id.nullable() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdatePrivacySettingsRequest = z.infer<typeof UpdatePrivacySettingsRequest>

/** The languages the admin and the site can be shown in now (i18n/locales). More come with nynorsk and English (PLAN). */
export const SITE_LOCALES = [{ code: 'nb', name: 'Norsk bokmål' }] as const
