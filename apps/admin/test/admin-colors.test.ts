import { ADMIN_COLOR_SCHEMES } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { ADMIN_COLOR_SCHEME_SETTINGS, colorModeFor, colorsFor } from '../app/utils/admin-colors.ts'
import { contrast, over, paletteStep, white } from './support/contrast.ts'

// What Nuxt UI starts with (`ui.colors` of its default config), and the app does not change.
const BASE = {
  primary: 'green',
  secondary: 'blue',
  success: 'green',
  info: 'blue',
  warning: 'yellow',
  error: 'red',
  neutral: 'slate',
}

describe('the admin colour schemes', () => {
  it('map every scheme the api knows, and only those', () => {
    expect(Object.keys(ADMIN_COLOR_SCHEME_SETTINGS).sort()).toEqual([...ADMIN_COLOR_SCHEMES].sort())
  })

  it("keep today's look for `default`: the app's palettes, the system's mode", () => {
    expect(colorModeFor('default')).toBe('system')
    expect(colorsFor(BASE, 'default')).toEqual(BASE)
  })

  it('force light for `light`, with the same palettes', () => {
    expect(colorModeFor('light')).toBe('light')
    expect(colorsFor(BASE, 'light')).toEqual(BASE)
  })

  it('force dark for `midnight`, with a zinc neutral and an indigo primary', () => {
    expect(colorModeFor('midnight')).toBe('dark')
    expect(colorsFor(BASE, 'midnight')).toEqual({ ...BASE, primary: 'indigo', neutral: 'zinc' })
  })

  it("follow the system for `ocean`, with a sky primary on the app's neutral", () => {
    expect(colorModeFor('ocean')).toBe('system')
    expect(colorsFor(BASE, 'ocean')).toEqual({ ...BASE, primary: 'sky' })
  })

  it('change only primary and neutral, and never the base object', () => {
    const base = { ...BASE }
    for (const scheme of ADMIN_COLOR_SCHEMES) {
      const colors = colorsFor(base, scheme)
      expect(colors.success).toBe('green')
      expect(colors.error).toBe('red')
      expect(colors.info).toBe('blue')
      expect(colors.warning).toBe('yellow')
    }
    expect(base).toEqual(BASE)
  })

  it('use palettes that Tailwind has, and nothing else', () => {
    for (const scheme of ADMIN_COLOR_SCHEMES) {
      for (const palette of Object.values(colorsFor(BASE, scheme))) {
        expect(() => paletteStep(palette, 500), `${scheme}: ${palette}`).not.toThrow()
      }
    }
  })
})

// WCAG 1.4.3: text and the primary button at 4.5:1 in every scheme and in every mode the scheme can be shown in. The steps are those
// of assets/theme/tokens/colors.css (light: primary-700, dark: primary-400) and app.config.ts (hover: 800 in light, 300 in dark; soft
// text: 800 in light, 400 in dark). Nuxt UI's neutral text steps are 500 (muted) and 700 (default) in light, 400 and 200 in dark.
const MODES = { light: ['light'], dark: ['dark'], system: ['light', 'dark'] } as const

describe.each(ADMIN_COLOR_SCHEMES)('contrast of the %s scheme', (scheme) => {
  const colors = colorsFor(BASE, scheme)
  const primary = colors.primary ?? 'green'
  const neutral = colors.neutral ?? 'slate'
  const modes = MODES[colorModeFor(scheme)]

  it.runIf(modes.some((mode) => mode === 'light'))('reads in light mode', () => {
    const step = (palette: string, n: number) => paletteStep(palette, n)
    const pairs: Record<string, number> = {
      'link on the page': contrast(step(primary, 700), white),
      'link on a muted surface': contrast(step(primary, 700), step(neutral, 50)),
      'solid button text': contrast(white, step(primary, 700)),
      'solid button text on hover': contrast(white, step(primary, 800)),
      'soft badge text': contrast(step(primary, 800), over(step(primary, 700), white, 0.1)),
      'muted text': contrast(step(neutral, 500), white),
      'muted text on a muted surface': contrast(step(neutral, 500), step(neutral, 50)),
      'body text': contrast(step(neutral, 700), white),
    }
    for (const [name, ratio] of Object.entries(pairs)) {
      expect(ratio, `${scheme}, light: ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.runIf(modes.some((mode) => mode === 'dark'))('reads in dark mode', () => {
    const step = (palette: string, n: number) => paletteStep(palette, n)
    const page = step(neutral, 900)
    const pairs: Record<string, number> = {
      'link on the page': contrast(step(primary, 400), page),
      'link on an elevated surface': contrast(step(primary, 400), step(neutral, 800)),
      'solid button text': contrast(page, step(primary, 400)),
      'solid button text on hover': contrast(page, step(primary, 300)),
      'soft badge text': contrast(step(primary, 400), over(step(primary, 400), page, 0.1)),
      'muted text': contrast(step(neutral, 400), page),
      'muted text on an elevated surface': contrast(step(neutral, 400), step(neutral, 800)),
      'body text': contrast(step(neutral, 200), page),
    }
    for (const [name, ratio] of Object.entries(pairs)) {
      expect(ratio, `${scheme}, dark: ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the status colours', () => {
  // success-800, error-700, info-700 and warning-800 in light, 400 in dark (colors.css), as text on a tint of themselves.
  it.each([
    ['success', 'green', 800],
    ['error', 'red', 700],
    ['info', 'blue', 700],
    ['warning', 'yellow', 800],
  ] as const)('%s text on its tint reads in both modes', (_role, palette, lightStep) => {
    const light = paletteStep(palette, lightStep)
    expect(contrast(light, over(light, white, 0.1))).toBeGreaterThanOrEqual(4.5)
    const dark = paletteStep(palette, 400)
    const page = paletteStep('slate', 900)
    expect(contrast(dark, over(dark, page, 0.1))).toBeGreaterThanOrEqual(4.5)
  })
})
