import { expect, test } from './helpers/fixtures.ts'

// What the admin sends with its pages (K-314). The CSP is made per response by nuxt-security; the nonce in the header
// must be the one on every script and style tag, or the browser blocks the page.

const NONCE = /'nonce-([A-Za-z0-9+/=_-]+)'/

test('the CSP has a nonce, and every script and style tag carries it', async ({ request }) => {
  const response = await request.get('/admin/login')
  expect(response.status()).toBe(200)
  const csp = response.headers()['content-security-policy'] ?? ''
  const nonce = NONCE.exec(csp)?.[1]
  expect(nonce, `no nonce in: ${csp}`).toBeTruthy()

  const html = await response.text()
  const tags = [...html.matchAll(/<(script|style|link)\b([^>]*)>/g)]
  const needing = tags.filter(
    ([, name, attributes]) => name !== 'link' || /rel="(stylesheet|modulepreload)"/.test(attributes ?? ''),
  )
  expect(needing.length).toBeGreaterThan(3)
  for (const [tag, , attributes] of needing) {
    expect(attributes, tag).toContain(`nonce="${nonce}"`)
  }
  // No inline event handler and no inline style attribute in the server-rendered page.
  expect(html).not.toMatch(/\son[a-z]+="/)
  expect(html).not.toMatch(/\sstyle="/)

  // A new nonce for each response (a nonce that is reused is no nonce).
  const again = await request.get('/admin/login')
  expect(NONCE.exec(again.headers()['content-security-policy'] ?? '')?.[1]).not.toBe(nonce)
})

test('the CSP is strict where it matters', async ({ request }) => {
  const csp = (await request.get('/admin/login')).headers()['content-security-policy'] ?? ''
  const directives = new Map(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/)
        return [name, values.join(' ')] as const
      }),
  )
  expect(directives.get('default-src')).toBe("'none'")
  expect(directives.get('script-src')).toMatch(/^'self' 'strict-dynamic' 'nonce-[^']+'$/)
  expect(directives.get('script-src-attr')).toBe("'none'")
  expect(directives.get('style-src')).toMatch(/^'self' 'nonce-[^']+'$/)
  expect(directives.has('style-src-attr')).toBe(false)
  expect(directives.get('object-src')).toBe("'none'")
  expect(directives.get('base-uri')).toBe("'none'")
  expect(directives.get('frame-ancestors')).toBe("'none'")
  expect(directives.get('form-action')).toBe("'self'")
  expect(directives.get('connect-src')).toBe("'self'")
  expect(directives.get('img-src')).toBe("'self' data:")
  expect(csp).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toContain('upgrade-insecure-requests')
})

test('the other security headers, and a page that is never cached', async ({ request }) => {
  const headers = (await request.get('/admin/login')).headers()
  expect(headers['cache-control']).toBe('no-store')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  expect(headers['permissions-policy']).toContain('camera=()')
  // Plain http (and the proxy does not trust a forged X-Forwarded-Proto): no HSTS.
  expect(headers['strict-transport-security']).toBeUndefined()
  const forged = await request.get('/admin/login', { headers: { 'X-Forwarded-Proto': 'https' } })
  expect(forged.headers()['strict-transport-security']).toBeUndefined()
  // Every screen, not only the login: the same policy.
  for (const path of ['/admin/register', '/admin/logout', '/admin/login?action=lostpassword']) {
    const response = await request.get(path, { maxRedirects: 0 })
    if (response.status() === 200) {
      expect(response.headers()['content-security-policy'], path).toBeTruthy()
    }
  }
})

test('the built files are served with a long cache and the pages of the site are not touched', async ({ request }) => {
  const html = await (await request.get('/admin/login')).text()
  const asset = /\/admin\/_nuxt\/[A-Za-z0-9_-]+\.js/.exec(html)?.[0]
  expect(asset).toBeTruthy()
  const file = await request.get(asset ?? '')
  expect(file.headers()['cache-control']).toContain('immutable')

  // The site app has no nonce CSP of this kind: the admin's policy is not in its pages.
  const site = await request.get('/')
  expect(site.headers()['content-security-policy']).toBeUndefined()
})
