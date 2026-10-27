// «Utseende → Tilpass» (M1.5, K-150, K-151): the site's identity (title, tagline, logo, icon), the active theme's colours and fonts
// (stored per theme, in `extension_state`), and «Ekstra CSS». What the site reads of it is under /public/customize.
import { z } from 'zod'

import { ContentMediaRef } from './content.ts'
import { FontStack, HexColor } from './theme.ts'

/** The most «Ekstra CSS» may hold (WordPress has no limit; a stylesheet this size is already a theme of its own). */
export const CUSTOM_CSS_MAX_LENGTH = 100_000

/**
 * Why «Ekstra CSS» cannot be written into the page's `<style>`, or undefined when it can: a `<` could end the element (`</style>`)
 * or start markup, so it is refused anywhere, as a backslash-escaped one (`\3c`) is in CSS too. A `>` is fine (a child selector).
 */
export function customCssProblem(css: string): string | undefined {
  if (css.length > CUSTOM_CSS_MAX_LENGTH) return `at most ${String(CUSTOM_CSS_MAX_LENGTH)} characters`
  if (css.includes('<')) return 'no < (it could end the <style> element)'
  if (/\\0*3c/i.test(css)) return 'no escaped < (\\3c)'
  return undefined
}

export const CustomCss = z
  .string()
  .refine((css) => customCssProblem(css) === undefined, { message: 'not CSS that can stand in a <style> element' })

/** A theme's choices as stored for that theme. A colour or font the theme does not name any more is left out when it is read. */
export const ThemeCustomization = z.object({
  colors: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), HexColor),
  fonts: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), FontStack),
  customCss: CustomCss,
})
export type ThemeCustomization = z.infer<typeof ThemeCustomization>
export const EMPTY_CUSTOMIZATION: ThemeCustomization = { colors: {}, fonts: {}, customCss: '' }

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

export const CustomizeIdentity = z.object({
  blogname: z.string().max(200),
  blogdescription: z.string().max(500),
  site_logo: z.uuid().nullable(),
  site_icon: z.uuid().nullable(),
})
export type CustomizeIdentity = z.infer<typeof CustomizeIdentity>

/** GET /customize?theme=: what Tilpass shows for the active theme, and whether the account may change «Ekstra CSS». */
export const CustomizeResponse = z.object({
  theme: Slug,
  identity: CustomizeIdentity,
  customization: ThemeCustomization,
  media: z.array(ContentMediaRef),
  mayEditCss: z.boolean(),
})
export type CustomizeResponse = z.infer<typeof CustomizeResponse>

/** PATCH /customize: the parts that changed. «Ekstra CSS» needs edit_css. */
export const UpdateCustomizeRequest = z.strictObject({
  theme: Slug,
  /** The theme's version (theme.json), kept with its settings. */
  version: z.string().max(50),
  identity: CustomizeIdentity.extend({
    site_logo: z.uuid().transform((value) => value.toLowerCase()).nullable(),
    site_icon: z.uuid().transform((value) => value.toLowerCase()).nullable(),
  })
    .partial()
    .optional(),
  colors: ThemeCustomization.shape.colors.optional(),
  fonts: ThemeCustomization.shape.fonts.optional(),
  customCss: CustomCss.optional(),
})
export type UpdateCustomizeRequest = z.infer<typeof UpdateCustomizeRequest>

/** GET /public/customize?theme=: what the site draws: the theme's choices and «Ekstra CSS», the logo and the icon. */
export const PublicCustomizeResponse = z.object({
  customization: ThemeCustomization,
  logo: ContentMediaRef.nullable(),
  icon: ContentMediaRef.nullable(),
  cacheTags: z.array(z.string()),
})
export type PublicCustomizeResponse = z.infer<typeof PublicCustomizeResponse>

/**
 * The CSS the site writes for a theme's choices: the colours and fonts as variables, then «Ekstra CSS». Only values that passed their
 * schema come here, and the CSS passed customCssProblem: nothing in it can end the `<style>` element.
 */
export function customizationCss(customization: ThemeCustomization): string {
  const variables = [
    ...Object.entries(customization.colors).map(([slug, color]) => `--theme-color-${slug}: ${color};`),
    ...Object.entries(customization.fonts).map(([slug, font]) => `--theme-font-${slug}: ${font};`),
  ]
  return [variables.length === 0 ? '' : `:root { ${variables.join(' ')} }`, customization.customCss].filter(Boolean).join('\n')
}
