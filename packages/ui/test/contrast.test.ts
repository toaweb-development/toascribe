// «Blekk» (M2.1): every colour pair holds WCAG 2.2 AA in both themes (Tor: fix what fails rather than except it).
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { PAIRS, contrast, measure, tokensOf } from '../src/contrast.ts'

const css = readFileSync(new URL('../app/assets/theme/tokens/colors.css', import.meta.url), 'utf8')

describe('the colour tokens', () => {
  it('are all there in both themes', () => {
    const names = new Set(PAIRS.flatMap((pair) => [pair.fg, pair.bg]))
    for (const theme of [':root', '.dark'] as const) {
      const tokens = tokensOf(css, theme)
      for (const name of names) expect(tokens[name], `${theme} --blekk-${name}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('hold their contrast in both themes', () => {
    const failing = measure(css)
      .filter((row) => !row.ok)
      .map(
        (row) =>
          `${row.theme}: ${row.fg} on ${row.bg} is ${row.ratio.toFixed(2)}, needs ${String(row.min)} (${row.use})`,
      )
    expect(failing).toEqual([])
  })

  it('measures as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})
