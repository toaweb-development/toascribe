import { describe, expect, it } from 'vitest'

import { displaySiteName } from '../app/utils/site-name.ts'

describe('displaySiteName', () => {
  it('is the name from the settings', () => {
    expect(displaySiteName({ siteName: 'Kaffekroken' }, 'toascribe')).toBe('Kaffekroken')
  })

  it('is trimmed, and a name of spaces counts as empty', () => {
    expect(displaySiteName({ siteName: '  Kaffekroken ' }, 'toascribe')).toBe('Kaffekroken')
    expect(displaySiteName({ siteName: '   ' }, 'toascribe')).toBe('toascribe')
  })

  it.each([{ siteName: '' }, null, undefined])('falls back to the product name for %j', (options) => {
    expect(displaySiteName(options, 'toascribe')).toBe('toascribe')
  })
})
