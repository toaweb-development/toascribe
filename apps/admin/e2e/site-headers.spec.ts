import { expect, expectNoAxeViolations, test } from './helpers/fixtures.ts'

// What the public site sends with its pages (K-314). Like the admin, the site makes a CSP with a nonce for each response. What
// differs from the admin is `img-src` (any https image, for themes), `frame-ancestors` ('self': the admin's «Tilpass» preview frames it, M1.5) and the
// cache rule (the page is private: a nonce that a shared cache hands to many is no nonce).

const NONCE = /'nonce-([A-Za-z0-9+/=_-]+)'/

function directivesOf(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/)
        return [name, values.join(' ')] as const
      }),
  )
}

test('the CSP has a nonce, and every script and style tag of the site carries it', async ({ request }) => {
  const response = await request.get('/')
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
    // A JSON data block is not executed; Nuxt's payload is one.
    if (/type="application\/json"/.test(attributes ?? '')) continue
    expect(attributes, tag).toContain(`nonce="${nonce}"`)
  }
  expect(html).not.toMatch(/\son[a-z]+="/)
  expect(html).not.toMatch(/\sstyle="/)

  const again = await request.get('/')
  expect(NONCE.exec(again.headers()['content-security-policy'] ?? '')?.[1]).not.toBe(nonce)
})

test('the CSP is strict where it matters, and open where a public site needs it', async ({ request }) => {
  const csp = (await request.get('/')).headers()['content-security-policy'] ?? ''
  const directives = directivesOf(csp)
  expect(directives.get('default-src')).toBe("'none'")
  expect(directives.get('script-src')).toMatch(/^'self' 'strict-dynamic' 'nonce-[^']+'$/)
  expect(directives.get('script-src-attr')).toBe("'none'")
  expect(directives.get('style-src')).toMatch(/^'self' 'nonce-[^']+'$/)
  expect(directives.has('style-src-attr')).toBe(false)
  expect(directives.get('object-src')).toBe("'none'")
  expect(directives.get('base-uri')).toBe("'none'")
  expect(directives.get('form-action')).toBe("'self'")
  expect(directives.get('connect-src')).toBe("'self'")
  expect(directives.get('font-src')).toBe("'self'")
  // Images from any https host (themes show them) and small inline ones; nothing else is opened.
  expect(directives.get('img-src')).toBe("'self' data: https:")
  // Only the site's own origin frames it: the admin's «Tilpass» preview (M1.5).
  expect(directives.get('frame-ancestors')).toBe("'self'")
  expect(csp).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toContain('upgrade-insecure-requests')
})

test('the other security headers, and a page that no shared cache may keep', async ({ request }) => {
  const headers = (await request.get('/')).headers()
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(headers['permissions-policy']).toContain('camera=()')
  expect(headers['cache-control']).toBe('private, no-cache')
  // The public site is meant to be found.
  expect(headers['x-robots-tag']).toBeUndefined()
  expect(headers['x-powered-by']).toBeUndefined()
  // Plain http, and the proxy does not trust a forged X-Forwarded-Proto: no HSTS.
  expect(headers['strict-transport-security']).toBeUndefined()
  const forged = await request.get('/', { headers: { 'X-Forwarded-Proto': 'https' } })
  expect(forged.headers()['strict-transport-security']).toBeUndefined()
})

test('the built files of the site keep their long cache, and the admin keeps its own policy', async ({ request }) => {
  const html = await (await request.get('/')).text()
  const asset = /\/_nuxt\/[A-Za-z0-9_-]+\.js/.exec(html)?.[0]
  expect(asset).toBeTruthy()
  expect((await request.get(asset ?? '')).headers()['cache-control']).toContain('immutable')

  const admin = (await request.get('/admin/login')).headers()
  expect(directivesOf(admin['content-security-policy'] ?? '').get('frame-ancestors')).toBe("'none'")
  expect(directivesOf(admin['content-security-policy'] ?? '').get('img-src')).toBe("'self' data:")
  expect(admin['x-frame-options']).toBe('DENY')
  expect(admin['cache-control']).toBe('no-store')
})

test('the home page runs under the CSP with a clean console, and passes axe', async ({ page }) => {
  // The fixture fails the test on a CSP violation, a console error or warning (a hydration mismatch is one).
  await page.goto('/')
  // The default theme's front page: the latest posts, under a heading for screen readers (M1.4).
  await expect(page.getByRole('heading', { level: 1, name: 'Siste innlegg' })).toBeAttached()
  await expect(page.getByRole('main')).toBeVisible()
  // Wait for the scripts to finish loading, so a blocked one would have been reported before the console is checked.
  await page.waitForLoadState('networkidle')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoAxeViolations(page, 'site home')
})
