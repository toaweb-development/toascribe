import type { AdminColorScheme } from '@toascribe/shared'

// WordPress' «Fargeskjema for administrasjonen», in Nuxt UI's terms (M0.5). The api only stores the key
// (`preferences.adminColorScheme`); this maps it to a colour mode and to the palettes of two Nuxt UI roles. Only palettes
// that Nuxt UI (Tailwind) already has: no hex, no new colour, no new token. The contrast fixes in assets/theme/tokens/colors.css
// pick a step of whatever palette the role has (`--ui-color-primary-700`), so they hold for every scheme (test/admin-colors.test.ts
// measures it).

/** What `useColorMode().preference` takes. */
export type ColorModePreference = 'system' | 'light' | 'dark'

/** The roles a scheme may change. Every other role (success, info, warning, error) keeps Nuxt UI's palette. */
export type SchemeColors = Partial<Record<'primary' | 'neutral', string>>

export interface AdminColorSchemeSetting {
  /** `system` follows the visitor's operating system; `light` and `dark` force it. */
  mode: ColorModePreference
  /** Overrides of the palettes the app starts with. Empty = the app's own look. */
  colors: SchemeColors
}

export const ADMIN_COLOR_SCHEME_SETTINGS: Readonly<Record<AdminColorScheme, AdminColorSchemeSetting>> = {
  // The look the admin had before schemes: the app's palettes, light or dark as the system says.
  default: { mode: 'system', colors: {} },
  // The same palettes, always light.
  light: { mode: 'light', colors: {} },
  // Always dark, with the zinc neutral and an indigo primary.
  midnight: { mode: 'dark', colors: { primary: 'indigo', neutral: 'zinc' } },
  // A sky-blue primary on the app's own neutral, light or dark as the system says.
  ocean: { mode: 'system', colors: { primary: 'sky' } },
}

/** The colour mode a scheme asks for. */
export function colorModeFor(scheme: AdminColorScheme): ColorModePreference {
  return ADMIN_COLOR_SCHEME_SETTINGS[scheme].mode
}

/**
 * The palettes for a scheme: what the app started with (`base`, Nuxt UI's `ui.colors` as the build left them), with the
 * scheme's own on top. A new object, so the caller can assign it.
 */
export function colorsFor(base: Readonly<Record<string, string>>, scheme: AdminColorScheme): Record<string, string> {
  return { ...base, ...ADMIN_COLOR_SCHEME_SETTINGS[scheme].colors }
}
