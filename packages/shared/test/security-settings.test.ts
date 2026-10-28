// «Personvern → Sikkerhet» (M1.8, K-319): the two values become lines of /.well-known/security.txt, so each must be one line of
// printable ASCII. A line break, a space or a control character is refused when it is stored.
import { describe, expect, it } from 'vitest'

import { CoreSettings } from '../src/index.ts'

const contact = CoreSettings.shape.security_contact
const policy = CoreSettings.shape.security_policy

describe('security.txt settings', () => {
  it('take a mailto: address, an https: address or nothing', () => {
    for (const value of ['', 'mailto:sikkerhet@example.no', 'https://example.no/meld-fra']) {
      expect(contact.safeParse(value).success, value).toBe(true)
    }
    for (const value of ['', 'https://example.no/sikkerhet']) expect(policy.safeParse(value).success, value).toBe(true)
  })

  it('refuse a line break, a space, a control character and another scheme', () => {
    for (const value of [
      'mailto:a@b.no\nPolicy: https://evil.example',
      'mailto:a b@b.no',
      'mailto:a\u0000@b.no',
      'https://b.no/ x',
      'http://b.no/',
      'javascript:alert(1)',
    ]) {
      expect(contact.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
    for (const value of [
      'https://a.example/x\nContact: mailto:evil@x.io',
      'https://a.example/x y',
      'https://a.example/ ',
      'http://a.example/',
    ]) {
      expect(policy.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })
})
