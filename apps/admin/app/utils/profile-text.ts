import type { AdminColorScheme } from '@toascribe/shared'

import type { Translator } from './shell-text.ts'

// The names of the admin's themes (M2.1, «Blekk»; WordPress' «Fargeskjema for administrasjonen»). Each key is asked for with a
// literal translate call, so the root test (test/i18n-strings.test.ts) sees that the message is in use.

export function schemeName({ t }: Pick<Translator, 't'>, scheme: AdminColorScheme): string {
  switch (scheme) {
    case 'system':
      return t('profile.scheme.system')
    case 'light':
      return t('profile.scheme.light')
    case 'dark':
      return t('profile.scheme.dark')
  }
}

export function schemeHint({ t }: Pick<Translator, 't'>, scheme: AdminColorScheme): string {
  switch (scheme) {
    case 'system':
      return t('profile.scheme.systemHint')
    case 'light':
      return t('profile.scheme.lightHint')
    case 'dark':
      return t('profile.scheme.darkHint')
  }
}

/** The icon of each theme on the profile (decoration: the name is the label). */
export const SCHEME_ICONS: Readonly<Record<AdminColorScheme, string>> = {
  system: 'i-lucide-monitor',
  light: 'i-lucide-sun',
  dark: 'i-lucide-moon',
}
