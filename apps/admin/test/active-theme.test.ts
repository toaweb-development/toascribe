import type { ActiveTheme } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { headingLevelsFor, templateItemsFor } from '../app/utils/active-theme.ts'

const THEME: ActiveTheme = {
  slug: 'default',
  name: 'Standard',
  version: '1.0.0',
  parents: [],
  headingLevels: [2, 3, 4],
  templates: [
    { slug: 'full-width', name: 'Full bredde', types: ['page'] },
    { slug: 'wide-post', name: 'Bredt innlegg', types: ['post'] },
  ],
  menus: {},
  areas: {},
  globalSets: [],
  settings: {},
}
const DEFAULT = { value: 'default', label: 'Standardmal' }

describe("the editor's choices from the active theme", () => {
  it("offers the theme's heading levels, and keeps a heading's own", () => {
    expect(headingLevelsFor(THEME, 2)).toEqual([2, 3, 4])
    expect(headingLevelsFor(THEME, 1)).toEqual([1, 2, 3, 4])
    expect(headingLevelsFor(null, 2)).toEqual([2, 3, 4, 5, 6])
  })

  it("offers the theme's templates for the type, and keeps one it no longer offers", () => {
    expect(templateItemsFor(THEME, 'page', null, DEFAULT)).toEqual([
      DEFAULT,
      { value: 'full-width', label: 'Full bredde' },
    ])
    expect(templateItemsFor(THEME, 'post', 'old', DEFAULT)).toEqual([
      DEFAULT,
      { value: 'wide-post', label: 'Bredt innlegg' },
      { value: 'old', label: 'old' },
    ])
    expect(templateItemsFor(null, 'page', 'default', DEFAULT)).toEqual([DEFAULT])
  })
})
