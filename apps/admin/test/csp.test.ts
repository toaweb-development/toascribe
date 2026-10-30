// Gravatar's host in the admin's img-src (M2.1): added to the policy nuxt-security wrote, once, and only as a plain host.
import { describe, expect, it } from 'vitest'

import { withImageHost } from '../server/lib/csp.ts'

const POLICY = "default-src 'none'; img-src 'self' data:; script-src 'self' 'nonce-abc';"

describe('withImageHost', () => {
  it('adds the host to img-src and leaves the rest', () => {
    expect(withImageHost(POLICY, 'secure.gravatar.com')).toBe(
      "default-src 'none'; img-src 'self' data: https://secure.gravatar.com; script-src 'self' 'nonce-abc';",
    )
  })

  it('adds it once, and nothing that is not a plain host', () => {
    const once = withImageHost(POLICY, 'secure.gravatar.com')
    expect(withImageHost(once, 'secure.gravatar.com')).toBe(once)
    for (const host of ['*', 'https://x.example', 'x.example/path', 'x.example; script-src *', '']) {
      expect(withImageHost(POLICY, host), host).toBe(POLICY)
    }
  })

  it('makes no img-src of its own', () => {
    expect(withImageHost("default-src 'none';", 'secure.gravatar.com')).toBe("default-src 'none';")
  })
})
