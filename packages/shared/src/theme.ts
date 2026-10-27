// The theme manifest, `theme.json` (PLAN «Temaspesifikasjon og installasjon», M1.4). The site's build reads the manifest of the
// theme chosen in `toascribe.toml` and of its parent, checks it against this schema and stops with the errors when it does not
// pass; the admin reads what the editor needs (heading levels, page templates) from the site at `/_toascribe/theme`. The contract
// is versioned (`themeApi`): a theme that asks for another version is refused with a message, rather than half working.
import { z } from 'zod'

import { ContentTemplate, ContentTypeKey } from './content.ts'

/** The theme contract this core implements. The block-views class names are part of it (Tor's decision, M1.4). */
export const THEME_API = 1

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const Version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const Location = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
const Label = z.string().trim().min(1).max(100)

/** A page template a person can choose per item (WordPress' «Template Name:»): its file is `templates/<slug>.vue`. */
export const ThemeTemplate = z.strictObject({
  slug: ContentTemplate,
  name: Label,
  /** The types it is offered for. */
  types: z.array(ContentTypeKey).min(1),
})
export type ThemeTemplate = z.infer<typeof ThemeTemplate>

export const HeadingLevel = z.int().min(1).max(6)

/** A colour as Tilpass stores it: `#rrggbb`. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i)
/** A font stack a theme offers: family names, quotes, commas and spaces only, so it cannot leave its CSS declaration. */
export const FontStack = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9 ,'"-]+$/)

/** The colours and fonts a theme offers in Tilpass, by slug (the CSS variable is `--theme-color-<slug>` / `--theme-font-<slug>`). */
export const ThemeSettingsSpec = z.strictObject({
  colors: z.record(Location, z.strictObject({ name: Label, default: HexColor })).optional(),
  fonts: z
    .record(
      Location,
      z.strictObject({
        name: Label,
        default: FontStack,
        choices: z
          .array(z.strictObject({ label: Label, value: FontStack }))
          .min(1)
          .max(30),
      }),
    )
    .optional(),
})
export type ThemeSettingsSpec = z.infer<typeof ThemeSettingsSpec>

export const ThemeManifest = z.strictObject({
  /** The address of the published JSON Schema, for an editor's completion (PLAN). */
  $schema: z.string().optional(),
  name: Label,
  slug: Slug,
  version: Version,
  description: z.string().max(1000).optional(),
  author: z.string().max(200).optional(),
  authorUri: z.url().optional(),
  themeUri: z.url().optional(),
  license: z.string().max(100).optional(),
  requires: z.strictObject({
    themeApi: z.literal(THEME_API, { message: `this core implements themeApi ${String(THEME_API)}` }),
    toascribe: Version.optional(),
  }),
  /** The parent theme's slug (a child theme, WordPress' «Template»). */
  parent: Slug.optional(),
  /** Menu locations (phase 1, M1.5): slug → shown name. */
  menus: z.record(Location, Label).optional(),
  /** Widget areas (M1.5): slug → shown name. */
  areas: z.record(Location, Label).optional(),
  /** The global sets the theme reads (`useGlobalSet`, M1.5): made empty in «Globale sett» when there is none of the slug. */
  globalSets: z
    .array(z.strictObject({ slug: Slug, name: Label }))
    .max(50)
    .optional(),
  supports: z
    .strictObject({
      /** The heading levels the editor offers (Tor, M1.4): e.g. [2, 3, 4], when the theme draws the title as <h1>. */
      headingLevels: z
        .array(HeadingLevel)
        .min(1)
        .refine((levels) => new Set(levels).size === levels.length, { message: 'each level once' })
        .optional(),
      featuredImage: z.boolean().optional(),
      comments: z.boolean().optional(),
    })
    .optional(),
  /** What «Utseende → Tilpass» offers (K-150, M1.5): the theme's colours and fonts, each with its default. */
  settings: ThemeSettingsSpec.optional(),
  templates: z
    .array(ThemeTemplate)
    .max(50)
    .refine((list) => new Set(list.map((entry) => entry.slug)).size === list.length, {
      message: 'each template slug once',
    })
    .optional(),
  imageSizes: z
    .array(
      z.strictObject({
        name: Location,
        width: z.int().min(0).max(10_000),
        height: z.int().min(0).max(10_000),
        crop: z.boolean().optional(),
      }),
    )
    .optional(),
})
export type ThemeManifest = z.infer<typeof ThemeManifest>

/** What the admin reads from the site (`GET /_toascribe/theme`): the active theme as the editor needs it. */
export const ActiveTheme = z.object({
  slug: Slug,
  name: Label,
  version: Version,
  /** The chain from the active theme to its parent. */
  parents: z.array(Slug),
  headingLevels: z.array(HeadingLevel),
  /** The page templates of the theme and its parent (the child's wins on the same slug). */
  templates: z.array(ThemeTemplate),
  menus: z.record(z.string(), z.string()),
  areas: z.record(z.string(), z.string()),
  globalSets: z.array(z.object({ slug: Slug, name: Label })),
  settings: ThemeSettingsSpec,
})
export type ActiveTheme = z.infer<typeof ActiveTheme>

/** Every level, when the theme does not say. */
export const DEFAULT_HEADING_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6]
