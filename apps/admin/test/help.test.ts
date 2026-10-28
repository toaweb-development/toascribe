// «Hjelp» (M1.8, K-038): every screen links to a page of the user documentation that exists, at the running version's tag.
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { HELP_PAGES, helpPage, helpUrl } from '../app/utils/help.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const pagesDir = fileURLToPath(new URL('../app/pages', import.meta.url))

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? screens(join(dir, entry.name))
      : [
          `/${relative(pagesDir, join(dir, entry.name))
            .replace(/\.vue$/, '')
            .replace(/(^|\/)index$/, '')}`,
        ],
  )
}

describe('help links', () => {
  it('names only documentation pages that exist', () => {
    for (const page of new Set([...HELP_PAGES.map(([, name]) => name), 'README'])) {
      expect(existsSync(join(root, 'docs/user', `${page}.md`)), page).toBe(true)
    }
  })

  it('gives every signed-in screen a page, and the overview to the dashboard', () => {
    const outside = new Set(['/login', '/logout', '/register', '/setup', '/'])
    for (const screen of screens(pagesDir).filter((path) => !outside.has(path))) {
      expect(helpPage(screen.replace(/\[[^\]]+\]/g, 'x')), screen).not.toBe('README')
    }
    expect(helpPage('/')).toBe('README')
    expect(helpPage('/appearance/menus')).toBe('menyer')
    expect(helpPage('/appearance/customize')).toBe('tema')
    expect(helpPage('/postsx')).toBe('README')
  })

  it('links at the tag of the version', () => {
    expect(helpUrl('/media/new', '1.0.0')).toBe(
      'https://github.com/toaweb-development/toascribe/blob/v1.0.0/docs/user/media.md',
    )
  })
})
