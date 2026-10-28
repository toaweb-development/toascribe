// The admin's language (M1.8, K-330): the profile's choice, then the site's language, then bokmål.
import { describe, expect, it } from 'vitest'

import { pickAdminLocale } from '../app/utils/admin-locale.ts'

describe('pickAdminLocale', () => {
  it("takes the account's own choice first", () => {
    expect(pickAdminLocale('en', 'nb')).toBe('en')
    expect(pickAdminLocale('nb', 'en')).toBe('nb')
  })

  it('follows the site without a choice, a regional tag counting as its language', () => {
    expect(pickAdminLocale(null, 'en')).toBe('en')
    expect(pickAdminLocale(undefined, 'en-GB')).toBe('en')
    expect(pickAdminLocale(null, 'nb')).toBe('nb')
  })

  it('passes over a language the admin has no messages for, and ends in bokmål', () => {
    expect(pickAdminLocale('de', 'en')).toBe('en')
    expect(pickAdminLocale(null, 'sv')).toBe('nb')
    expect(pickAdminLocale(null, '')).toBe('nb')
    expect(pickAdminLocale(null, null)).toBe('nb')
  })
})
