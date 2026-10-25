import type { AdminColorScheme } from '@toascribe/shared'

import type { Translator } from './shell-text.ts'

// The names of the admin colour schemes (WordPress' «Fargeskjema for administrasjonen»). Each key is asked for with a literal
// translate call, so the root test (test/i18n-strings.test.ts) sees that the message is in use.

export function schemeName({ t }: Pick<Translator, 't'>, scheme: AdminColorScheme): string {
  switch (scheme) {
    case 'default':
      return t('profile.scheme.default')
    case 'light':
      return t('profile.scheme.light')
    case 'midnight':
      return t('profile.scheme.midnight')
    case 'ocean':
      return t('profile.scheme.ocean')
  }
}

export function schemeHint({ t }: Pick<Translator, 't'>, scheme: AdminColorScheme): string {
  switch (scheme) {
    case 'default':
      return t('profile.scheme.defaultHint')
    case 'light':
      return t('profile.scheme.lightHint')
    case 'midnight':
      return t('profile.scheme.midnightHint')
    case 'ocean':
      return t('profile.scheme.oceanHint')
  }
}

/**
 * Swatch colours per scheme, as Tailwind palette classes (literal strings so Tailwind finds them): the page, a surface and the
 * primary colour of the scheme. Only palettes that utils/admin-colors.ts uses; the swatch is decoration, the name is the label.
 */
export const SCHEME_SWATCHES: Readonly<Record<AdminColorScheme, readonly [string, string, string]>> = {
  default: ['bg-slate-50', 'bg-slate-900', 'bg-green-600'],
  light: ['bg-white', 'bg-slate-200', 'bg-green-600'],
  midnight: ['bg-zinc-900', 'bg-zinc-700', 'bg-indigo-400'],
  ocean: ['bg-slate-100', 'bg-slate-700', 'bg-sky-500'],
}
