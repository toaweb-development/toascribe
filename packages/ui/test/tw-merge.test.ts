// «Blekk»'s own class names survive the class merge Nuxt UI runs (M2.1): a font size or radius of ours next to a colour or a Nuxt UI
// radius is kept, not dropped as a «colour» or overridden.
import { extendTailwindMerge } from 'tailwind-merge'
import { describe, expect, it } from 'vitest'

import { BLEKK_TW_MERGE } from '../src/tw-merge.ts'

const merge = extendTailwindMerge(BLEKK_TW_MERGE)

describe('the class merge with Blekk names', () => {
  it('keeps a Blekk font size beside a text colour, and the colour beside it', () => {
    expect(merge('text-sm text-highlighted text-card-title').split(' ')).toEqual(
      expect.arrayContaining(['text-highlighted', 'text-card-title']),
    )
    expect(merge('text-highlighted text-body').split(' ')).toEqual(['text-highlighted', 'text-body'])
  })

  it('lets a Blekk radius replace a Nuxt UI one', () => {
    expect(merge('rounded-lg rounded-card')).toBe('rounded-card')
    expect(merge('rounded-md rounded-field')).toBe('rounded-field')
  })

  it('lets a Blekk control height replace a default one', () => {
    expect(merge('min-h-8 min-h-control')).toBe('min-h-control')
  })
})
