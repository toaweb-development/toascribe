// The contrast of «Blekk»'s colour pairs (M2.1, WCAG 2.2 AA): every pair the screens draw, in both themes, read from the token file
// itself so a changed colour is measured at once. Text needs 4.5:1 (1.4.3); the edge of a field or a button, a focus ring and a
// status dot need 3:1 against what they sit on (1.4.11). The test (test/contrast.test.ts) fails on any pair below its floor, and
// `pnpm --filter @toascribe/ui contrast` prints the whole table.

export type Theme = 'light' | 'dark'
export type Tokens = Readonly<Record<string, string>>

/** The `--blekk-*` tokens of a CSS block (`:root { … }` or `.dark { … }`), without the prefix. */
export function tokensOf(css: string, selector: ':root' | '.dark'): Tokens {
  const escaped = selector.replace('.', '\\.')
  const block = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  const tokens: Record<string, string> = {}
  for (const match of block.matchAll(/--blekk-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match
    if (name !== undefined && value !== undefined) tokens[name] = value.toLowerCase()
  }
  return tokens
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of `#rrggbb` (WCAG 2.2). */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0)
}

/** The contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

export interface Pair {
  readonly fg: string
  readonly bg: string
  readonly min: 3 | 4.5
  readonly use: string
  /** The background is `bg` at this opacity over `under` (Nuxt UI's `bg-error/75` on hover, `bg-primary/10` behind a soft badge). */
  readonly alpha?: number
  readonly under?: string
}

/** `#rrggbb` at `alpha` over `#rrggbb`, as the browser blends it. */
export function over(top: string, bottom: string, alpha: number): string {
  const channelOf = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  return `#${[1, 3, 5]
    .map((at) => Math.round(channelOf(top, at) * alpha + channelOf(bottom, at) * (1 - alpha)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Nuxt UI's roles as Blekk fills them (tokens/colors.css): the colour of `bg-<role>` and `text-<role>`. `--ui-text-inverted` is the
 * surface. A filled primary button takes the accent fill (app.config.ts), not the primary role.
 */
const ROLES = {
  primary: 'accent-text',
  success: 'success-text',
  warning: 'warning-text',
  error: 'danger',
  info: 'accent-text',
} as const
const INVERTED = 'surface'

const TEXT_ON_SURFACES = ['bg', 'surface', 'sunken', 'topbar'] as const
const TEXTS = ['text', 'heading', 'secondary', 'muted', 'accent-text', 'danger'] as const

/** Every pair a screen draws. */
export const PAIRS: readonly Pair[] = [
  ...TEXTS.flatMap((fg) => TEXT_ON_SURFACES.map((bg) => ({ fg, bg, min: 4.5 as const, use: 'text' }))),
  { fg: 'accent-text', bg: 'accent-weak', min: 4.5, use: 'the selected item' },
  { fg: 'text', bg: 'accent-weak', min: 4.5, use: 'text of the selected item' },
  { fg: 'accent-hover', bg: 'surface', min: 4.5, use: 'a link under the pointer' },
  { fg: 'accent-hover', bg: 'bg', min: 4.5, use: 'a link under the pointer' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, use: 'a filled button' },
  { fg: 'success-text', bg: 'success-bg', min: 4.5, use: 'a success message or badge' },
  { fg: 'success-text', bg: 'surface', min: 4.5, use: 'success text' },
  { fg: 'warning-text', bg: 'warning-bg', min: 4.5, use: 'a warning' },
  { fg: 'warning-text', bg: 'warning-badge', min: 4.5, use: 'a warning badge' },
  { fg: 'danger', bg: 'surface', min: 4.5, use: 'a danger button or message' },
  { fg: 'sidebar-text', bg: 'sidebar', min: 4.5, use: 'the side menu' },
  { fg: 'sidebar-muted', bg: 'sidebar', min: 4.5, use: 'the side menu, quiet' },
  { fg: 'sidebar-text', bg: 'sidebar-active', min: 4.5, use: 'the active menu item' },
  { fg: 'sidebar-muted', bg: 'sidebar-active', min: 4.5, use: 'the active menu item, quiet' },
  { fg: 'border-strong', bg: 'surface', min: 3, use: 'the edge of a field or button' },
  { fg: 'border-strong', bg: 'sunken', min: 3, use: 'the edge of a field on a sunken surface' },
  { fg: 'border-strong', bg: 'bg', min: 3, use: 'the edge of a field on the page' },
  { fg: 'accent', bg: 'surface', min: 3, use: 'the focus ring and a filled button on a card' },
  { fg: 'accent', bg: 'bg', min: 3, use: 'the focus ring on the page' },
  { fg: 'warning-dot', bg: 'warning-bg', min: 3, use: 'the dot of a warning' },
  { fg: 'warning-dot', bg: 'surface', min: 3, use: 'the dot of a warning on a card' },
  { fg: 'muted', bg: 'divider', min: 4.5, use: 'quiet text on an elevated row (--ui-bg-elevated)' },
  { fg: 'accent-hover', bg: 'accent-weak', min: 4.5, use: 'a selected link under the pointer' },
  { fg: 'on-accent', bg: 'accent', alpha: 0.9, under: 'surface', min: 4.5, use: 'a filled button under the pointer' },
  { fg: 'sidebar-focus', bg: 'sidebar', min: 3, use: 'the focus ring in the side menu' },
  { fg: 'sidebar-focus', bg: 'sidebar-active', min: 3, use: 'the focus ring on the active menu item' },
  { fg: 'accent-text', bg: 'surface', min: 3, use: 'the focus ring on a card' },
  { fg: 'accent-text', bg: 'bg', min: 3, use: 'the focus ring on the page' },
  // What Nuxt UI draws from the roles: a filled button of a role (text-inverted on bg-<role>, /90 under the pointer, app.config.ts),
  // and a soft badge or alert (text-<role> on bg-<role>/10) on a card and on the page.
  ...Object.entries(ROLES).flatMap(([role, token]) => [
    { fg: INVERTED, bg: token, min: 4.5 as const, use: `a filled ${role} button` },
    {
      fg: INVERTED,
      bg: token,
      alpha: 0.9,
      under: 'surface',
      min: 4.5 as const,
      use: `a filled ${role} button under the pointer`,
    },
    { fg: token, bg: token, alpha: 0.1, under: 'surface', min: 4.5 as const, use: `a soft ${role} badge on a card` },
    { fg: token, bg: token, alpha: 0.1, under: 'bg', min: 4.5 as const, use: `a soft ${role} badge on the page` },
  ]),
]

export interface Measured extends Pair {
  readonly theme: Theme
  readonly ratio: number
  readonly ok: boolean
}

/** Every pair measured in both themes. A token missing from a theme is measured as #000000 against itself: it fails. */
export function measure(css: string): Measured[] {
  const themes: Record<Theme, Tokens> = { light: tokensOf(css, ':root'), dark: tokensOf(css, '.dark') }
  return (['light', 'dark'] as const).flatMap((theme) =>
    PAIRS.map((pair) => {
      const fg = themes[theme][pair.fg] ?? '#000000'
      const plain = themes[theme][pair.bg] ?? '#000000'
      const bg =
        pair.alpha === undefined ? plain : over(plain, themes[theme][pair.under ?? 'surface'] ?? '#000000', pair.alpha)
      const ratio = contrast(fg, bg)
      return { ...pair, theme, ratio, ok: ratio >= pair.min }
    }),
  )
}
