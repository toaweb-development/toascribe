import { expect, test } from './helpers/fixtures.ts'
import { signIn } from './helpers/screens.ts'
import { createUser } from './helpers/stack.ts'
import { EXPECTED_STYLE_SRC_ATTR, LISTED_STYLE_ATTRIBUTES, styleAttributesIn } from './helpers/styles.ts'

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
  // Inline style attributes are refused, except the strings on the one list (csp-style-attributes.ts) that Nuxt UI and Reka UI write
  // into the server's HTML, let through by their hash alone: no `'unsafe-inline'`. The count follows the list, and `'unsafe-hashes'` is
  // in no script directive.
  expect(directives.get('style-src-attr')).toBe(EXPECTED_STYLE_SRC_ATTR)
  for (const name of ['script-src', 'script-src-attr', 'script-src-elem', 'style-src']) {
    expect(directives.get(name) ?? '', name).not.toContain('unsafe-hashes')
  }
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

test('the built files are served with a long cache and the site keeps its own policy', async ({ request }) => {
  const html = await (await request.get('/admin/login')).text()
  const asset = /\/admin\/_nuxt\/[A-Za-z0-9_-]+\.js/.exec(html)?.[0]
  expect(asset).toBeTruthy()
  const file = await request.get(asset ?? '')
  expect(file.headers()['cache-control']).toContain('immutable')

  // The site has a CSP of its own (site-headers.spec.ts): the admin's policy is not in its pages.
  const site = await request.get('/')
  expect(site.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(site.headers()['cache-control']).not.toBe('no-store')
})

// The one list of inline styles (csp-style-attributes.ts) is the whole of what the CSP lets through. This loads the screens it can reach
// without a one-time link or a second factor the way the server draws it (the others are covered by the CSP-violation check of the
// specs that open them), with the sidebar open and with it collapsed, and compares the `style` attributes in the HTML with the list. A string
// that a new Nuxt UI or Reka UI version starts to write fails here with the screen that draws it, and a string no screen draws any
// more fails too, so the list cannot grow stale. (The setup wizard draws none: wizard.spec.ts checks its page on its own stack.)
test('every inline style the server draws is on the list, and the list holds nothing no screen draws', async ({
  page,
  request,
  allowFailedRequests,
}) => {
  allowFailedRequests()
  const drawn = new Map<string, Set<string>>()
  const note = (screen: string, html: string) => {
    for (const value of styleAttributesIn(html)) {
      drawn.set(value, (drawn.get(value) ?? new Set()).add(screen))
    }
  }

  for (const path of ['/admin/login', '/admin/login?action=lostpassword', '/admin/logout']) {
    const answer = await request.get(path)
    expect(answer.status(), path).toBe(200)
    note(`${path} (signed out)`, await answer.text())
  }

  const user = await createUser('administrator', 'cspadmin')
  await signIn(page, user)
  const origin = new URL(page.url()).origin
  const session = (await (await page.request.get('/api/v1/auth/session')).json()) as { csrfToken: string }
  const draft = await page.request.post('/api/v1/content', {
    headers: { 'X-CSRF-Token': session.csrfToken, origin },
    data: {
      type: 'post',
      title: 'CSP',
      blocks: [
        {
          id: 'b_cspcols',
          type: 'core/columns',
          version: 1,
          attrs: {},
          children: ['1', '2'].map((n) => ({
            id: `b_cspcol${n}`,
            type: 'core/column',
            version: 1,
            attrs: {},
            children: [
              {
                id: `b_csppara${n}`,
                type: 'core/paragraph',
                version: 1,
                attrs: { content: [{ type: 'text', text: 'x' }] },
                children: [],
              },
            ],
          })),
        },
        {
          id: 'b_cspimage',
          type: 'core/image',
          version: 1,
          attrs: { url: '/admin/no-such-image.png', alt: 'a' },
          children: [],
        },
      ],
    },
  })
  expect(draft.ok(), await draft.text()).toBe(true)
  const { id } = (await draft.json()) as { id: string }
  const page2 = await page.request.post('/api/v1/content', {
    headers: { 'X-CSRF-Token': session.csrfToken, origin },
    data: { type: 'page', title: 'CSP-side' },
  })
  expect(page2.ok(), await page2.text()).toBe(true)
  for (const collapsed of [false, true]) {
    // The sidebar keeps its state in a cookie that the server reads, so the collapsed rail is drawn on the server too.
    await page.context().addCookies([
      {
        name: 'dashboard-sidebar-admin',
        value: encodeURIComponent(JSON.stringify({ size: 15, collapsed })),
        url: origin,
      },
    ])
    for (const path of [
      '/admin/',
      '/admin/profile',
      '/admin/users',
      '/admin/users?search=a&orderby=email&order=desc',
      // The content lists (M1.1), the editor on a post of columns, an image and a paragraph (saved above), a new page, the preview.
      '/admin/posts',
      '/admin/posts?status=trash',
      '/admin/pages',
      `/admin/posts/${id}`,
      '/admin/pages/new',
      `/admin/preview/${id}`,
    ]) {
      const answer = await page.request.get(path)
      expect(answer.status(), path).toBe(200)
      expect(answer.url(), path).not.toContain('/login')
      note(`${path} (sidebar ${collapsed ? 'collapsed' : 'open'})`, await answer.text())
    }
  }

  const unlisted = [...drawn].filter(([value]) => !LISTED_STYLE_ATTRIBUTES.includes(value))
  expect(
    unlisted.map(([value, screens]) => `${value}  <- ${[...screens].join(', ')}`),
    'a style string the server draws that is not on the list in csp-style-attributes.ts',
  ).toEqual([])
  expect(
    LISTED_STYLE_ATTRIBUTES.filter((value) => !drawn.has(value)),
    'a listed string that no screen draws: remove it from csp-style-attributes.ts',
  ).toEqual([])
})
