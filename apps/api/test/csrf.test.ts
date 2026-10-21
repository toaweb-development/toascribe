// K-258 and K-311: a state-changing request needs a same-origin source, a JSON body and the session's CSRF token.
import { z } from '@hono/zod-openapi'
import { ApiError, SessionResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { authenticated } from '../src/lib/policy.ts'
import { defineRoute } from '../src/middleware/policy.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, TestClient, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'

noticeIfSkipped('csrf')

/** The state-changing calls of the api that need a session, each with what makes it work. */
const MUTATING = [
  { name: 'PATCH /me', method: 'PATCH', path: '/api/v1/me', json: { firstName: 'Ada' }, ok: 200 },
  { name: 'DELETE /me/sessions', method: 'DELETE', path: '/api/v1/me/sessions', json: undefined, ok: 200 },
  { name: 'POST /auth/logout', method: 'POST', path: '/api/v1/auth/logout', json: undefined, ok: 204 },
] as const

async function errorCode(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.code
}

describe.skipIf(TEST_DATABASE_URL === undefined)('CSRF and request origin (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let counter = 0

  /** A signed-in client, with its own account. */
  async function signedIn(): Promise<TestClient> {
    counter += 1
    const account = await env.createAccount({ username: `csrf${String(counter)}`, role: 'editor' })
    const client = env.client()
    expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    return client
  }

  beforeAll(async () => {
    env = await startAuthApp()
    // A route that takes uploads, to prove that multipart is allowed only where a route says so.
    const upload = defineRoute({
      method: 'post',
      path: '/api/v1/test/upload',
      policy: authenticated(),
      bodyType: 'multipart',
      responses: {
        200: { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'ok' },
      },
    })
    env.app.openapi(upload, (c) => c.json({ ok: true }, 200))
  })
  afterAll(async () => {
    await env.close()
  })

  describe.each(MUTATING)('$name', ({ method, path, json, ok }) => {
    const call = (client: TestClient, options: Parameters<TestClient['request']>[2] = {}) =>
      client.request(method, path, { ...(json === undefined ? {} : { json }), ...options })

    it('works with the right token', async () => {
      const client = await signedIn()
      expect((await call(client)).status).toBe(ok)
    })

    it('is refused without a token, and nothing happened', async () => {
      const client = await signedIn()
      const res = await call(client, { csrf: 'none' })
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('forbidden')
      expect((await client.get('/api/v1/me')).status).toBe(200) // still signed in: the logout did not run
      expect(
        ((await (await client.get('/api/v1/me')).json()) as { profile: { firstName: string } }).profile.firstName,
      ).toBe('')
    })

    it('is refused with a wrong token, an empty one, and one that is nearly right', async () => {
      const client = await signedIn()
      const real = client.csrfToken ?? ''
      for (const wrong of [
        'wrong',
        'x'.repeat(43),
        `${real}x`,
        real.slice(0, -1),
        real.toLowerCase() === real ? real.toUpperCase() : real.toLowerCase(),
        ' ',
      ]) {
        expect((await call(client, { csrf: wrong })).status, wrong).toBe(403)
      }
      expect((await call(client, { headers: { 'x-csrf-token': '' }, csrf: 'none' })).status).toBe(403)
    })

    it('is refused with the token of another session, even one of the same account', async () => {
      const mine = await signedIn()
      const theirs = await signedIn()
      expect(mine.csrfToken).not.toBe(theirs.csrfToken)
      expect((await call(mine, { csrf: theirs.csrfToken ?? '' })).status).toBe(403)

      const account = await env.createAccount({ username: `twice${String((counter += 1))}` })
      const first = env.client()
      const second = env.client()
      await first.login(account.username, TEST_PASSWORD)
      await second.login(account.username, TEST_PASSWORD)
      expect((await call(first, { csrf: second.csrfToken ?? '' })).status).toBe(403)
    })

    it('is refused from another origin, even with the right token', async () => {
      const client = await signedIn()
      for (const origin of [
        'https://evil.example',
        'http://cms.example.test',
        'https://cms.example.test:8443',
        'https://cms.example.test.evil.example',
        'null',
        'https://CMS.example.test',
      ]) {
        const res = await call(client, { origin })
        expect(res.status, origin).toBe(400)
        expect(await errorCode(res), origin).toBe('origin_invalid')
      }
      // And with no Origin at all and no Sec-Fetch-Site: fail closed.
      const none = await call(client, { origin: null })
      expect(none.status).toBe(400)
      expect(await errorCode(none)).toBe('origin_invalid')
    })

    it('is refused when the browser says the request is cross-site, whatever the Origin says', async () => {
      const client = await signedIn()
      for (const site of ['cross-site', 'same-site', 'none']) {
        const res = await call(client, { headers: { 'sec-fetch-site': site } })
        expect(res.status, site).toBe(400)
        expect(await errorCode(res)).toBe('origin_invalid')
      }
    })

    it('accepts Sec-Fetch-Site: same-origin without an Origin header', async () => {
      const client = await signedIn()
      expect((await call(client, { origin: null, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(ok)
    })
  })

  describe('content type', () => {
    it.each([
      ['text/plain', 'text/plain'],
      ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8'],
      ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
      ['multipart/form-data', 'multipart/form-data; boundary=x'],
      ['application/xml', 'application/xml'],
      ['application/jsonp', 'application/jsonp'],
      ['application/json-patch+json', 'application/json-patch+json'],
    ])('refuses a body sent as %s, with the right token and origin', async (_name, contentType) => {
      const client = await signedIn()
      const res = await client.request('PATCH', '/api/v1/me', { body: '{"firstName":"Ada"}', contentType })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('unsupported_media_type')
      expect(
        ((await (await client.get('/api/v1/me')).json()) as { profile: { firstName: string } }).profile.firstName,
      ).toBe('')
    })

    it('refuses a body with no content type', async () => {
      const client = await signedIn()
      const res = await client.request('PATCH', '/api/v1/me', {
        body: '{"firstName":"Ada"}',
        contentType: null,
        headers: { 'content-length': '18' },
      })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('unsupported_media_type')
    })

    it('refuses an empty form post too: the content type is what is checked', async () => {
      const client = await signedIn()
      const res = await client.request('POST', '/api/v1/auth/logout', {
        contentType: 'application/x-www-form-urlencoded',
      })
      expect(res.status).toBe(400)
      expect((await client.get('/api/v1/me')).status).toBe(200)
    })

    it('accepts application/json with parameters and in any case', async () => {
      const client = await signedIn()
      for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON']) {
        const res = await client.request('PATCH', '/api/v1/me', { body: '{"firstName":"Ada"}', contentType: type })
        expect(res.status, type).toBe(200)
      }
    })

    it('accepts a call with no body and no content type (DELETE)', async () => {
      const client = await signedIn()
      expect((await client.delete('/api/v1/me/sessions')).status).toBe(200)
    })

    it('multipart is allowed only on a route that says so', async () => {
      const client = await signedIn()
      const multipart = {
        body: '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--x--\r\n',
        contentType: 'multipart/form-data; boundary=x',
      }
      expect((await client.request('POST', '/api/v1/test/upload', multipart)).status).toBe(200)
      // The upload route still wants the token, the origin, and refuses other types.
      expect((await client.request('POST', '/api/v1/test/upload', { ...multipart, csrf: 'none' })).status).toBe(403)
      expect(
        (await client.request('POST', '/api/v1/test/upload', { ...multipart, origin: 'https://evil.example' })).status,
      ).toBe(400)
      expect(
        (
          await client.request('POST', '/api/v1/test/upload', {
            body: 'a=1',
            contentType: 'application/x-www-form-urlencoded',
          })
        ).status,
      ).toBe(400)
      expect(
        (await client.request('POST', '/api/v1/test/upload', { body: 'a', contentType: 'text/plain' })).status,
      ).toBe(400)
    })
  })

  describe('login has no session yet: origin and JSON only', () => {
    const body = { login: 'nobody', password: 'x' }

    it('refuses another origin, no origin, a cross-site Sec-Fetch-Site and a wrong content type', async () => {
      const client = env.client()
      for (const options of [
        { origin: 'https://evil.example' },
        { origin: null },
        { headers: { 'sec-fetch-site': 'cross-site' } },
      ]) {
        const res = await client.post('/api/v1/auth/login', body, { csrf: 'none', ...options })
        expect(res.status, JSON.stringify(options)).toBe(400)
        expect(await errorCode(res)).toBe('origin_invalid')
      }
      const text = await client.request('POST', '/api/v1/auth/login', {
        body: JSON.stringify(body),
        contentType: 'text/plain',
        csrf: 'none',
      })
      expect(text.status).toBe(400)
      expect(await errorCode(text)).toBe('unsupported_media_type')
      const form = await client.request('POST', '/api/v1/auth/login', {
        body: 'login=a&password=b',
        contentType: 'application/x-www-form-urlencoded',
        csrf: 'none',
      })
      expect(form.status).toBe(400)
      // The same body from our own origin is a normal failed login, not a rejected request.
      expect((await client.post('/api/v1/auth/login', body, { csrf: 'none' })).status).toBe(401)
    })

    it('does not need a CSRF token, and works with a stale one', async () => {
      const account = await env.createAccount({ username: `fresh${String((counter += 1))}` })
      const client = env.client()
      expect(
        (
          await client.post(
            '/api/v1/auth/login',
            { login: account.username, password: TEST_PASSWORD },
            { csrf: 'stale-token' },
          )
        ).status,
      ).toBe(200)
    })

    it('a login attempt refused for its origin is not counted against anyone', async () => {
      const before = await env.query<{ n: string }>('select count(*) as n from login_attempt')
      await env.client().post('/api/v1/auth/login', body, { csrf: 'none', origin: 'https://evil.example' })
      const after = await env.query<{ n: string }>('select count(*) as n from login_attempt')
      expect(after[0]?.n).toBe(before[0]?.n)
    })
  })

  describe('safe methods and public routes', () => {
    it('a GET needs no token, and no particular origin', async () => {
      const client = await signedIn()
      expect((await client.get('/api/v1/me', { csrf: 'none', origin: 'https://evil.example' })).status).toBe(200)
      expect((await client.get('/api/v1/me/sessions', { csrf: 'none', origin: null })).status).toBe(200)
    })

    it('GET /auth/session hands out the token that the login gave, the same on every call', async () => {
      const client = await signedIn()
      const first = SessionResponse.parse(await (await client.get('/api/v1/auth/session')).json())
      const second = SessionResponse.parse(await (await client.get('/api/v1/auth/session')).json())
      expect(first).toMatchObject({ status: 'authenticated', csrfToken: client.csrfToken })
      expect(second).toEqual(first)
      // A new session has a different token.
      const other = await signedIn()
      expect(other.csrfToken).not.toBe(client.csrfToken)
    })

    it('a token of a session that has ended works nowhere', async () => {
      const client = await signedIn()
      const stale = client.csrfToken ?? ''
      await client.post('/api/v1/auth/logout')
      const again = env.client()
      const account = await env.createAccount({ username: `after${String((counter += 1))}` })
      await again.login(account.username, TEST_PASSWORD)
      expect((await again.patch('/api/v1/me', { firstName: 'X' }, { csrf: stale })).status).toBe(403)
    })

    it('a request with a valid token but no session cookie is a 401, not a pass', async () => {
      const client = await signedIn()
      const res = await client.patch('/api/v1/me', { firstName: 'X' }, { cookie: null })
      expect(res.status).toBe(401)
    })
  })

  describe('what is logged', () => {
    it('a refused token is logged as a warning without the token, and the path without a query string', async () => {
      const client = await signedIn()
      const secretToken = 'attacker-chosen-secret-value'
      await client.patch('/api/v1/me?probe=1', { firstName: 'X' }, { csrf: secretToken })
      const line = env.lines.find((l) => l['msg'] === 'request refused: CSRF token missing or wrong')
      expect(line).toBeDefined()
      expect(line?.['path']).toBe('/api/v1/me')
      const all = JSON.stringify(env.lines)
      expect(all).not.toContain(secretToken)
      expect(all).not.toContain(client.csrfToken ?? 'no-token')
      expect(all).not.toContain(client.sessionToken ?? 'no-token')
    })
  })

  describe('the signing key', () => {
    it('a token made under another key is refused, and the session itself is still good', async () => {
      const client = await signedIn()
      const { createDb } = await import('@toascribe/db')
      const { buildApp } = await import('../src/app.ts')
      const { db, pool } = createDb({ connectionString: env.database.appUrl, max: 2 })
      try {
        const other = buildApp({
          pool,
          db,
          logger: (await import('pino')).pino({ level: 'silent' }),
          version: '9.9.9',
          publicOrigin: TEST_ORIGIN,
          signingKey: new Uint8Array(32).fill(9),
          keyRing: (await import('./helpers.ts')).testKeyRing,
          mail: (await import('./helpers.ts')).recordingMail(),
        }).app
        const sameCookie = new TestClient(other)
        sameCookie.cookie = client.cookie
        // The session cookie is accepted (the database row is the same) ...
        const session = SessionResponse.parse(await (await sameCookie.get('/api/v1/auth/session')).json())
        expect(session.status).toBe('authenticated')
        // ... but the first app's token is not valid under the second key, and the second key's token is the one that works there.
        expect(
          (await sameCookie.patch('/api/v1/me', { firstName: 'X' }, { csrf: client.csrfToken ?? '' })).status,
        ).toBe(403)
        const fresh = session.status === 'authenticated' ? session.csrfToken : ''
        expect(fresh).not.toBe(client.csrfToken)
        expect((await sameCookie.patch('/api/v1/me', { firstName: 'X' }, { csrf: fresh })).status).toBe(200)
        expect((await client.patch('/api/v1/me', { firstName: 'Y' }, { csrf: fresh })).status).toBe(403)
      } finally {
        await pool.end()
      }
    })
  })
})
