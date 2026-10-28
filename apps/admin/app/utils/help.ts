// «Hjelp» (M1.8, K-038; WordPress' Help tab, which PLAN keeps as links to the documentation): each admin screen links to the page
// of the user documentation (docs/user/, bokmål) that covers it, at the tag of the running version, so the text matches the
// install. A screen without its own page gets the overview.
import { RELEASE_REPOSITORY } from '@toascribe/shared'

/** The documentation page of each screen, by the first path that matches; the most specific first. */
export const HELP_PAGES: readonly (readonly [prefix: string, page: string])[] = [
  ['/posts', 'innhold'],
  ['/pages', 'innhold'],
  ['/categories', 'innhold'],
  ['/tags', 'innhold'],
  ['/preview', 'innhold'],
  ['/media', 'media'],
  ['/appearance/menus', 'menyer'],
  ['/appearance', 'tema'],
  ['/settings', 'innstillinger'],
  ['/updates', 'oppdatering'],
  ['/tools', 'sikkerhetskopi'],
  ['/users', 'brukere'],
  ['/profile', 'brukere'],
]

/** The page for a path inside the admin (without `/admin`): `README` (the overview) when no screen matches. */
export function helpPage(path: string): string {
  const match = HELP_PAGES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  return match?.[1] ?? 'README'
}

/** The address of the page on GitHub, at the version's tag. */
export function helpUrl(path: string, version: string): string {
  return `https://github.com/${RELEASE_REPOSITORY}/blob/v${version}/docs/user/${helpPage(path)}.md`
}
