// The theme lookup (M1.4): theme.json is checked, a child theme overrides one template and one block view of its parent and keeps
// the rest, the parent chain must match the layers, and `index` is required.
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ThemeError, blockTypeOf, resolveTheme } from '../lib/themes.ts'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const layer = (name: string, src = '') => ({ rootDir: fixture(name), srcDir: fixture(`${name}${src}`) })
const site = { rootDir: fixture('none'), srcDir: fixture('none/app') }
const core = { rootDir: fixture('none-core'), srcDir: fixture('none-core/app') }

describe('the theme of the site', () => {
  it("takes a parent theme's templates and block views", () => {
    const theme = resolveTheme([site, layer('parent', '/app'), core])
    expect([...theme.templates.keys()].sort()).toEqual(['full-width', 'index', 'single'])
    expect([...theme.blockViews.keys()].sort()).toEqual(['core/paragraph', 'core/quote'])
    expect(theme.active).toMatchObject({
      slug: 'forelder',
      parents: [],
      headingLevels: [2, 3, 4],
      templates: [{ slug: 'full-width', name: 'Full bredde', types: ['page'] }],
    })
  })

  it('lets a child theme override one template and one block view, and keeps the rest of its parent', () => {
    const theme = resolveTheme([site, layer('child'), layer('parent', '/app'), core])
    expect(theme.templates.get('single')).toBe(fixture('child/templates/single.vue'))
    expect(theme.templates.get('index')).toBe(fixture('parent/app/templates/index.vue'))
    expect(theme.blockViews.get('core/quote')).toBe(fixture('child/blocks/quote/View.vue'))
    expect(theme.blockViews.get('core/paragraph')).toBe(fixture('parent/app/blocks/paragraph/View.vue'))
    expect(theme.active).toMatchObject({
      slug: 'barn',
      parents: ['forelder'],
      // Not set by the child: the parent's.
      headingLevels: [2, 3, 4],
      menus: { primary: 'Hovedmeny', footer: 'Bunnmeny' },
    })
  })

  it('refuses a broken manifest with every error, and a chain that does not match the layers', () => {
    expect(() => resolveTheme([site, layer('broken'), core])).toThrow(ThemeError)
    try {
      resolveTheme([site, layer('broken'), core])
    } catch (error) {
      const problems = (error as ThemeError).problems.join('\n')
      for (const field of ['name', 'slug', 'version', 'requires.themeApi', 'colour']) expect(problems).toContain(field)
    }
    expect(() => resolveTheme([site, layer('child'), core])).toThrow(/forelder/)
    expect(() => resolveTheme([site, layer('parent', '/app'), layer('child'), core])).toThrow(/names no parent/)
  })

  it('requires templates/index.vue, and a file for each page template it offers', () => {
    expect(() => resolveTheme([site, layer('no-index', '/app'), core])).toThrow(/index\.vue is required/)
  })

  it('has no active theme and no error without a theme layer (the core on its own)', () => {
    expect(resolveTheme([site, core]).active).toBeNull()
  })

  it('names block types after their folders', () => {
    expect(blockTypeOf('quote')).toBe('core/quote')
    expect(blockTypeOf('acme.slider')).toBe('acme/slider')
    expect(blockTypeOf('../x')).toBeUndefined()
  })
})
