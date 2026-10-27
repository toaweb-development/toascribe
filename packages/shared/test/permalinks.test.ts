// Permalinks (M1.5, K-197, K-221): each WordPress structure gives the address WordPress gives, and reads it back; a structure is checked
// before it is stored.
import { describe, expect, it } from 'vitest'

import {
  PERMALINK_PRESETS,
  cleanBase,
  dateParts,
  matchPostPath,
  postPath,
  slugSegment,
  structureProblem,
} from '../src/index.ts'
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
    // A slug is stored URL-safe and goes in as it is.
    expect(postPath('/%postname%/', { ...POST, slug: 'bl%c3%a5b%c3%a6r' })).toBe('/bl%c3%a5b%c3%a6r/')
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
    expect(matchPostPath('/%postname%/', '/bl%c3%a5b%c3%a6r/')?.postname).toBe('bl%c3%a5b%c3%a6r')
  })

  it('do not read what does not fit', () => {
    expect(matchPostPath(PERMALINK_PRESETS.day, '/2026/10/hei-verden/')).toBeUndefined()
    expect(matchPostPath(PERMALINK_PRESETS.numeric, '/archives/hei/')).toBeUndefined()
    expect(matchPostPath(PERMALINK_PRESETS.plain, '/hei-verden/')).toBeUndefined()
    expect(matchPostPath('/%postname%/', '/a/b/')).toBeUndefined()
    expect(matchPostPath('/%postname%/', `/${'a'.repeat(2001)}/`)).toBeUndefined()
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
      '/blåbær/%postname%/',
      '/a:b/%postname%/',
      // Two or more free-text tags in one segment would make reading an address back slow (review M1.5).
      '/%category%-%postname%-%author%/',
      '/%category%%postname%%author%/',
      '/%category%a%postname%a%author%a/',
      '/%postname%-%author%/',
    ]) {
      expect(structureProblem(bad), bad).toBeDefined()
    }
  })

  it('cleans a base, and falls back to the default for an empty one', () => {
    expect(cleanBase('/emne/', 'category')).toBe('emne')
    expect(cleanBase('  ', 'tag')).toBe('tag')
  })
})

describe('reading an address back', () => {
  it('takes linear time on a long address, for every structure the check lets through', () => {
    const long = `/${'-'.repeat(1990)}/`
    for (const structure of ['/%category%/%postname%/', '/%year%-%postname%/', '/%category%/%author%/%postname%/']) {
      expect(structureProblem(structure), structure).toBeUndefined()
      const started = performance.now()
      matchPostPath(structure, long)
      expect(performance.now() - started, structure).toBeLessThan(200)
    }
  })

  it("compares segments in the slugs' stored form", () => {
    expect(slugSegment('blåbær')).toBe('bl%c3%a5b%c3%a6r')
    expect(slugSegment('о')).toBe('%d0%be')
    expect(slugSegment('a/b\\c%')).toBe('a%2fb%5cc%25')
    expect(slugSegment('Hei-1_2.3~')).toBe('Hei-1_2.3~')
  })
})
