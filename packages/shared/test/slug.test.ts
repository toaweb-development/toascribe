import { describe, expect, it } from 'vitest'

import {
  MAX_SLUG_LENGTH,
  removeAccents,
  sanitizeTitle,
  trashedSlug,
  truncateSlug,
  untrashedSlug,
} from '../src/index.ts'
import { REMOVE_ACCENTS_TABLE as TABLE } from '../src/slug-accents.ts'

// The expected values are what WordPress' sanitize_title() returns in the save context (formatting.php, trunk 2026-10-26).
describe('removeAccents', () => {
  it('turns the Norwegian letters into WordPress’ ASCII forms', () => {
    expect(removeAccents('Æ Ø Å æ ø å', 'nb')).toBe('AE O A ae o a')
  })

  it('applies the Danish and German changes only for those locales', () => {
    expect(removeAccents('Smørrebrød på Ærø', 'da')).toBe('Smoerrebroed paa Aeroe')
    expect(removeAccents('Grüße aus Köln', 'de-AT')).toBe('Gruesse aus Koeln')
    expect(removeAccents('Grüße aus Köln', 'nb')).toBe('Gruse aus Koln')
    expect(removeAccents('Đorđe', 'sr')).toBe('DJordje')
    expect(removeAccents('col·lecció', 'ca')).toBe('colleccio')
  })

  it('normalises a decomposed letter first (NFD to NFC)', () => {
    expect(removeAccents('ångstrøm', 'nb')).toBe('angstrom')
  })

  it('has WordPress’ 311 characters, the euro and the pound', () => {
    expect(Object.keys(TABLE)).toHaveLength(311)
    expect(TABLE['€']).toBe('E')
    expect(TABLE['£']).toBe('')
    expect(TABLE['ß']).toBe('s')
  })
})

describe('sanitizeTitle', () => {
  it.each([
    ['Blåbær på Ørland', 'blabaer-pa-orland'],
    ['Hei, verden!', 'hei-verden'],
    ['Personvernerklæring', 'personvernerklaering'],
    ['  -- foo   bar --  ', 'foo-bar'],
    ['Pris 100 % rabatt', 'pris-100-rabatt'],
    ['Versjon 1.5', 'versjon-1-5'],
    ['«Sitat» – og “mer”', 'sitat-og-mer'],
    ['inn/ut', 'inn-ut'],
    ['<b>Fet</b> tittel', 'fet-tittel'],
    ['5 × 3', '5-x-3'],
    ['Tom &amp; Jerry', 'tom-jerry'],
    ['snake_case_ok', 'snake_case_ok'],
    ['%C3%A6 kodet', '%c3%a6-kodet'],
    ['日本', '%e6%97%a5%e6%9c%ac'],
    ['Ünïcödé ÀÉÎ', 'unicode-aei'],
  ])('%s → %s', (title, slug) => {
    expect(sanitizeTitle(title, '', 'nb')).toBe(slug)
  })

  it('falls back when nothing is left', () => {
    expect(sanitizeTitle('!!!', '17')).toBe('17')
    expect(sanitizeTitle('', '17')).toBe('17')
  })

  it('never makes a slug longer than 200 characters, and never cuts an encoded character', () => {
    expect(sanitizeTitle('a'.repeat(250))).toHaveLength(MAX_SLUG_LENGTH)
    const encoded = sanitizeTitle('日'.repeat(100))
    expect(encoded.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(encoded).toBe('%e6%97%a5'.repeat(22))
  })
})

describe('slug length and trash', () => {
  it('cuts on a character boundary', () => {
    expect(truncateSlug('abcdef', 4)).toBe('abcd')
    expect(truncateSlug('%e6%97%a5%e6%9c%ac', 10)).toBe('%e6%97%a5')
  })

  it('adds and removes the trash suffix', () => {
    expect(trashedSlug('hei-verden')).toBe('hei-verden__trashed')
    expect(trashedSlug('a'.repeat(200))).toBe(`${'a'.repeat(191)}__trashed`)
    expect(untrashedSlug('hei-verden__trashed')).toBe('hei-verden')
    expect(untrashedSlug('hei-verden__trashed-3')).toBe('hei-verden')
    expect(untrashedSlug('hei-verden')).toBe('hei-verden')
  })
})
