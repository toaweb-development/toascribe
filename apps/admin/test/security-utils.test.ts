import { describe, expect, it } from 'vitest'

import { hstsFor, withoutEmptyStyleAttributes } from '../server/utils/security.ts'

describe('hstsFor', () => {
  it('is sent for a request that came in over https, for a year and with subdomains (security §7)', () => {
    expect(hstsFor('https')).toBe('max-age=31536000; includeSubDomains')
  })

  it.each([undefined, 'http', '', 'HTTPS', 'https, http', 'ws'])('is not sent for %j', (proto) => {
    expect(hstsFor(proto)).toBeUndefined()
  })
})

describe('withoutEmptyStyleAttributes', () => {
  it('takes out the empty style attribute of a server-rendered icon', () => {
    expect(withoutEmptyStyleAttributes('<svg class="a" style="" width="1em"></svg>')).toBe(
      '<svg class="a" width="1em"></svg>',
    )
  })

  it('keeps one that has a value: that one is blocked by the CSP, and meant to be', () => {
    const html = '<div style="color: red"></div><span style="">x</span>'
    expect(withoutEmptyStyleAttributes(html)).toBe('<div style="color: red"></div><span>x</span>')
  })

  it('leaves a page without any as it is', () => {
    expect(withoutEmptyStyleAttributes('<p>text</p>')).toBe('<p>text</p>')
  })
})
