// Permalinks (M1.5, K-197, K-221): each WordPress structure gives the address WordPress gives, and reads it back; a structure is checked
// before it is stored.
import { describe, expect, it } from 'vitest'

import { PERMALINK_PRESETS, cleanBase, dateParts, matchPostPath, postPath, structureProblem } from '../src/index.ts'
import type { PermalinkParts } from '../src/index.ts'

const POST: PermalinkParts = {
  shortId: 12,
  slug: 'hei-verden',
  ...dateParts(new Date('2026-10-26T23:30:05Z'), 'Europe/Oslo'),
  category: 'nyheter/lokalt',
  author: 'kari',
}

describe('the structures', () => {
  it('give the addresses WordPress gives, with the date in the site time zone', () => {
    expect(POST).toMatchObject({ year: '2026', monthnum: '10', day: '27', hour: '00', minute: '30', second: '05' })
    expect(postPath(PERMALINK_PRESETS.plain, POST)).toBe('/?p=12')
    expect(postPath(PERMALINK_PRESETS.day, POST)).toBe('/2026/10/27/hei-verden/')
    expect(postPath(PERMALINK_PRESETS.month, POST)).toBe('/2026/10/hei-verden/')
    expect(postPath(PERMALINK_PRESETS.numeric, POST)).toBe('/archives/12')
    expect(postPath(PERMALINK_PRESETS.postname, POST)).toBe('/hei-verden/')
    expect(postPath('/%category%/%author%/%hour%%minute%%second%/%postname%/', POST)).toBe(
      '/nyheter/lokalt/kari/003005/hei-verden/',
    )
    expect(postPath('/%postname%/', { ...POST, slug: 'blåbær' })).toBe('/bl%C3%A5b%C3%A6r/')
  })

  it('read each address back, with a page number after it and the closing slash optional', () => {
    for (const structure of Object.values(PERMALINK_PRESETS).filter((value) => value !== '')) {
      const path = postPath(structure, POST)
      const found = matchPostPath(structure, path)
      expect(found, structure).toBeDefined()
      expect(found?.postname ?? found?.post_id, structure).toBe(structure.includes('%postname%') ? 'hei-verden' : '12')
      expect(matchPostPath(structure, `${path.replace(/\/$/, '')}/2/`)?.page, structure).toBe(2)
    }
    expect(matchPostPath(PERMALINK_PRESETS.day, '/2026/10/27/hei-verden')).toMatchObject({ day: '27', page: 1 })
    expect(matchPostPath('/%category%/%postname%/', '/nyheter/lokalt/hei-verden/')).toMatchObject({
      category: 'nyheter/lokalt',
      postname: 'hei-verden',
    })
    expect(matchPostPath('/%category%/%postname%/', '/nyheter/lokalt/hei-verden/3/')).toMatchObject({ page: 3 })
    expect(matchPostPath('/%postname%/', '/bl%C3%A5b%C3%A6r/')?.postname).toBe('blåbær')
  })

  it('do not read what does not fit', () => {
    expect(matchPostPath(PERMALINK_PRESETS.day, '/2026/10/hei-verden/')).toBeUndefined()
    expect(matchPostPath(PERMALINK_PRESETS.numeric, '/archives/hei/')).toBeUndefined()
    expect(matchPostPath(PERMALINK_PRESETS.plain, '/hei-verden/')).toBeUndefined()
    expect(matchPostPath('/%postname%/', '/a/b/')).toBeUndefined()
    expect(matchPostPath('/%postname%/', '/%E0%A4%A/')).toBeUndefined()
  })
})

describe('what is stored', () => {
  it('takes a structure with %postname% or %post_id% and only known tags', () => {
    for (const structure of Object.values(PERMALINK_PRESETS))
      expect(structureProblem(structure), structure).toBeUndefined()
    expect(structureProblem('/blogg/%year%/%postname%.html')).toBeUndefined()
    for (const bad of [
      'hei/%postname%/',
      '/%year%/%monthnum%/',
      '/%postname%/%postname%/',
      '/%tag%/%postname%/',
      '/%postname%/?x=1',
      '//%postname%/',
      '/%postname% /',
      '/100%/%postname%/',
    ]) {
      expect(structureProblem(bad), bad).toBeDefined()
    }
  })

  it('cleans a base, and falls back to the default for an empty one', () => {
    expect(cleanBase('/emne/', 'category')).toBe('emne')
    expect(cleanBase('  ', 'tag')).toBe('tag')
  })
})
