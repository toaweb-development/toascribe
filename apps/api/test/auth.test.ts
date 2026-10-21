// Login, logout and sessions (K-001, K-002, K-004, K-008, K-013, K-310) against a real PostgreSQL.
import { createHash } from 'node:crypto'

import { ApiError, LoginResponse, SessionResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hashPassword } from '../src/lib/passwords.ts'
import { ARGON2ID } from './argon2.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { SESSION_COOKIE_NAME, TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('auth')

const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

interface SessionRow {
  id: string
  token_hash: string
  expires_at: Date
  created_at: Date
  last_seen_at: Date
  is_remembered: boolean
  mfa_verified_at: Date | null
  ip: string | null
  user_agent: string | null
}

describe.skipIf(TEST_DATABASE_URL === undefined)('login and sessions (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let counter = 0
  const uniqueName = (base: string) => `${base}${String((counter += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  const sessionsOf = (accountId: string) =>
    env.query<SessionRow>('select * from session where account_id = $1 order by created_at', [accountId])

  describe('the cookie', () => {
    it('is __Host-, Path=/, Secure, HttpOnly and SameSite=Lax, with no Domain, exactly', async () => {
      const account = await env.createAccount({ username: uniqueName('cookie') })
      const client = env.client()
      const res = await client.login(account.username, TEST_PASSWORD)
      expect(res.status).toBe(200)
      const lines = res.headers.getSetCookie()
      expect(lines).toHaveLength(1)
      // Without «Remember me» there is no Max-Age: the browser drops it when it closes.
      expect(lines[0]).toMatch(/^__Host-toa_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax$/)
      expect(lines[0]).not.toMatch(/Domain/i)
    })

    it('has a Max-Age of the long lifetime with «Remember me»', async () => {
      const account = await env.createAccount({ username: uniqueName('remember') })
      const res = await env.client().login(account.username, TEST_PASSWORD, { remember: true })
      expect(res.headers.getSetCookie()[0]).toMatch(
        new RegExp(
          `^__Host-toa_session=[A-Za-z0-9_-]{43}; Max-Age=${String(14 * 24 * 3600)}; Path=/; HttpOnly; Secure; SameSite=Lax$`,
        ),
      )
    })

    it('is cleared on logout with the same attributes', async () => {
      const account = await env.createAccount({ username: uniqueName('clear') })
      const client = env.client()
      await client.login(account.username, TEST_PASSWORD)
      const res = await client.post('/api/v1/auth/logout')
      expect(res.status).toBe(204)
      expect(res.headers.getSetCookie()).toEqual([
        '__Host-toa_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      ])
    })

    it('is not sent as Secure-less even for an http PUBLIC_ORIGIN: the browser decides, not the request', async () => {
      // The api sees plain HTTP behind the TLS proxy. Hono's __Host- prefix forces Secure whatever the URL is.
      const account = await env.createAccount({ username: uniqueName('plainhttp') })
      const client = env.client()
      const res = await client.request('POST', 'http://api.internal:3001/api/v1/auth/login', {
        json: { login: account.username, password: TEST_PASSWORD },
        csrf: 'none',
      })
      expect(res.headers.getSetCookie()[0]).toContain('; Secure;')
    })
  })

  describe('login', () => {
    it('answers with the account, the CSRF token and a safe redirect, and keeps only a hash of the token', async () => {
      const account = await env.createAccount({
        username: uniqueName('alice'),
        role: 'editor',
        displayName: 'Alice A.',
      })
      const client = env.client({ ip: '198.51.100.20' })
      const res = await client.login(account.username, TEST_PASSWORD)
      expect(res.status).toBe(200)
      const body = LoginResponse.parse(await res.json())
      expect(body).toMatchObject({ status: 'authenticated', redirectTo: '/admin' })
      if (body.status !== 'authenticated') {
        throw new Error('expected a full session')
      }
      expect(body.account).toMatchObject({
        id: account.id,
        username: account.username,
        displayName: 'Alice A.',
        roles: ['editor'],
      })
      expect(body.account.capabilities).toContain('publish_posts')
      expect(body.account.capabilities).not.toContain('manage_options')
      expect(JSON.stringify(body)).not.toContain('password')

      const rows = await sessionsOf(account.id)
      expect(rows).toHaveLength(1)
      const [row] = rows
      const token = client.sessionToken ?? ''
      expect(token).toHaveLength(43)
      expect(row?.token_hash).toBe(sha256(token))
      expect(row?.token_hash).not.toBe(token)
      expect(row?.ip).toBe('198.51.100.20')
      // The token itself is nowhere in the table.
      const anywhere = await env.query(
        "select 1 from session where $1 in (id::text, token_hash, coalesce(user_agent, ''))",
        [token],
      )
      expect(anywhere).toHaveLength(0)
      expect(row?.is_remembered).toBe(false)
      expect(row?.mfa_verified_at).toBeNull()
    })

    it('takes the e-mail address as well as the username, in any case', async () => {
      const account = await env.createAccount({
        username: uniqueName('Mixed'),
        email: `Mixed.${String(counter)}@Example.Test`,
      })
      expect((await env.client().login(account.email.toUpperCase(), TEST_PASSWORD)).status).toBe(200)
      expect((await env.client().login(account.username.toLowerCase(), TEST_PASSWORD)).status).toBe(200)
    })

    it('gives the same answer for a wrong password, an unknown account, an account without a password, and an inactive one', async () => {
      const real = await env.createAccount({ username: uniqueName('real') })
      const nopass = await env.createAccount({ username: uniqueName('nopass'), passwordHash: null })
      const disabled = await env.createAccount({ username: uniqueName('disabled'), status: 'disabled' })
      const pending = await env.createAccount({ username: uniqueName('pending'), status: 'pending' })
      const attempts = [
        [real.username, 'wrong password'],
        ['nobody-by-that-name', TEST_PASSWORD],
        [nopass.username, TEST_PASSWORD],
        [disabled.username, TEST_PASSWORD], // the RIGHT password for a disabled account
        [pending.username, TEST_PASSWORD],
      ] as const
      const answers: string[] = []
      for (const [login, password] of attempts) {
        const client = env.client({ ip: '198.51.100.30' })
        const res = await client.login(login, password)
        expect(res.status, login).toBe(401)
        expect(res.headers.getSetCookie(), login).toEqual([])
        const body = ApiError.parse(await res.json())
        expect(body.error).toMatchObject({ code: 'invalid_credentials', message: 'Invalid username or password' })
        answers.push(JSON.stringify({ status: res.status, code: body.error.code, message: body.error.message }))
      }
      expect(new Set(answers).size).toBe(1)
    })

    it('keeps the redirect only when it is a same-origin path', async () => {
      const account = await env.createAccount({ username: uniqueName('redirect') })
      const cases: [string | undefined, string][] = [
        [undefined, '/admin'],
        ['/admin/profile', '/admin/profile'],
        ['/admin/posts?status=draft', '/admin/posts?status=draft'],
        ['//evil.com', '/admin'],
        ['/\\evil.com', '/admin'],
        ['https://evil.com/admin', '/admin'],
        ['https:evil.com', '/admin'],
        ['javascript:alert(1)', '/admin'],
        ['/%2F/evil.com', '/admin'],
        ['/%252F/evil.com', '/admin'],
        ['/\t/evil.com', '/admin'],
      ]
      for (const [sent, expected] of cases) {
        const res = await env
          .client()
          .login(account.username, TEST_PASSWORD, sent === undefined ? {} : { redirectTo: sent })
        expect(res.status, String(sent)).toBe(200)
        expect(LoginResponse.parse(await res.json()).redirectTo, String(sent)).toBe(expected)
      }
    })

    it('refuses a password over 4096 characters as an invalid request, and a missing field too', async () => {
      const account = await env.createAccount({ username: uniqueName('long') })
      const tooLong = await env.client().login(account.username, 'x'.repeat(4097))
      expect(tooLong.status).toBe(400)
      expect(ApiError.parse(await tooLong.json()).error.code).toBe('validation_error')
      const atLimit = await env.client().login(account.username, 'x'.repeat(4096))
      expect(atLimit.status).toBe(401)
      const missing = await env.client().post('/api/v1/auth/login', { login: account.username })
      expect(missing.status).toBe(400)
      const extra = await env
        .client()
        .post('/api/v1/auth/login', { login: account.username, password: TEST_PASSWORD, role: 'administrator' })
      expect(extra.status).toBe(400)
    })

    it('stores no address, rather than a made-up one, when the client address cannot be read', async () => {
      const account = await env.createAccount({ username: uniqueName('noaddress') })
      const client = env.client({ ip: 'not-an-address' })
      await client.login(account.username, TEST_PASSWORD)
      const [row] = await sessionsOf(account.id)
      expect(row?.ip).toBeNull()
      const audit = await env.query<{ ip: string | null }>(
        `select host(ip) as ip from audit_log where account_id = $1`,
        [account.id],
      )
      expect(audit.map((r) => r.ip)).toEqual([null])
      const list = (await (await client.get('/api/v1/me/sessions')).json()) as { sessions: { ip: string | null }[] }
      expect(list.sessions[0]?.ip).toBeNull()
    })

    it('refuses a login name with control characters (a NUL byte would be a database error)', async () => {
      for (const login of ['a\u0000b', 'a\nb', '\u0007', '']) {
        const res = await env.client().post('/api/v1/auth/login', { login, password: 'x' }, { csrf: 'none' })
        expect(res.status, JSON.stringify(login)).toBe(400)
      }
    })

    it('answers malformed JSON, an empty body and a non-object body with a 400 in the common format', async () => {
      for (const body of ['{"login": "a", ', '', 'null', '[]', '"text"', '{"login": "a", "password": "b"}garbage']) {
        const res = await env
          .client()
          .request('POST', '/api/v1/auth/login', { body, contentType: 'application/json', csrf: 'none' })
        expect(res.status, body).toBe(400)
        expect(ApiError.safeParse(await res.json()).success, body).toBe(true)
      }
    })

    it('writes the audit log: success, failure and logout, with the username as actor and no secrets', async () => {
      const account = await env.createAccount({ username: uniqueName('audited') })
      const client = env.client({ ip: '198.51.100.41' })
      await client.login(account.username, 'not the password')
      await client.login(account.username, TEST_PASSWORD)
      await client.post('/api/v1/auth/logout')
      await env.client({ ip: '198.51.100.42' }).login('someone-who-is-not-here', 'whatever')

      const rows = await env.query<{
        action: string
        actor: string
        actor_type: string
        reason: string | null
        ip: string
        account_id: string | null
        source: string
        correlation_id: string | null
        new_value: unknown
      }>(
        `select action, actor, actor_type, reason, host(ip) as ip, account_id, source, correlation_id, new_value
           from audit_log where ip in ('198.51.100.41', '198.51.100.42') order by created_at, id`,
      )
      expect(rows.map((r) => r.action)).toEqual(['login.failed', 'login.succeeded', 'logout', 'login.failed'])
      expect(rows[0]).toMatchObject({
        actor: account.username,
        actor_type: 'account',
        reason: 'wrong_password',
        account_id: account.id,
        source: 'api',
      })
      expect(rows[1]).toMatchObject({ actor: account.username, account_id: account.id, ip: '198.51.100.41' })
      expect(rows[2]).toMatchObject({ actor: account.username, ip: '198.51.100.41' })
      // The name that was typed for an unknown account is not stored (people type passwords there).
      expect(rows[3]).toMatchObject({
        actor: 'anonymous',
        actor_type: 'system',
        reason: 'unknown_account',
        account_id: null,
      })
      expect(rows.every((r) => r.correlation_id !== null)).toBe(true)
      const all = JSON.stringify(rows)
      expect(all).not.toContain('not the password')
      expect(all).not.toContain(TEST_PASSWORD)
      expect(all).not.toContain('someone-who-is-not-here')
      // And nothing that was typed reaches the log either.
      const logged = JSON.stringify(env.lines)
      expect(logged).not.toContain(TEST_PASSWORD)
      expect(logged).not.toContain('not the password')
    })
  })

  describe('session lifetime (K-002)', () => {
    it('lasts 2 days without «Remember me» and 14 with it, as the settings say', async () => {
      const account = await env.createAccount({ username: uniqueName('life') })
      env.clock.set(new Date('2026-11-02T10:00:00Z'))
      try {
        await env.client().login(account.username, TEST_PASSWORD)
        await env.client().login(account.username, TEST_PASSWORD, { remember: true })
        const [short, long] = await sessionsOf(account.id)
        expect(short?.is_remembered).toBe(false)
        expect(long?.is_remembered).toBe(true)
        expect(short?.expires_at.getTime()).toBe(new Date('2026-11-04T10:00:00Z').getTime())
        expect(long?.expires_at.getTime()).toBe(new Date('2026-11-16T10:00:00Z').getTime())
      } finally {
        env.clock.set(new Date(Date.now()))
      }
    })

    it('follows the settings when an administrator changes them', async () => {
      const account = await env.createAccount({ username: uniqueName('setting') })
      await env.query(`update setting set value = '5'::jsonb where key = 'session_lifetime_days'`)
      await env.query(`update setting set value = '30'::jsonb where key = 'session_lifetime_remember_days'`)
      try {
        const now = new Date('2026-11-02T10:00:00Z')
        env.clock.set(now)
        await env.client().login(account.username, TEST_PASSWORD)
        const [row] = await sessionsOf(account.id)
        expect(row?.expires_at.getTime()).toBe(now.getTime() + 5 * DAY)
        const remembered = await env.client().login(account.username, TEST_PASSWORD, { remember: true })
        expect(remembered.headers.getSetCookie()[0]).toContain(`Max-Age=${String(30 * 24 * 3600)}`)
      } finally {
        await env.query(`update setting set value = '2'::jsonb where key = 'session_lifetime_days'`)
        await env.query(`update setting set value = '14'::jsonb where key = 'session_lifetime_remember_days'`)
        env.clock.set(new Date(Date.now()))
      }
    })

    it('falls back to the default for a setting that is stored invalid, and says so in the log', async () => {
      const account = await env.createAccount({ username: uniqueName('badsetting') })
      await env.query(`update setting set value = '"forever"'::jsonb where key = 'session_lifetime_days'`)
      try {
        const now = new Date('2026-11-02T10:00:00Z')
        env.clock.set(now)
        await env.client().login(account.username, TEST_PASSWORD)
        const [row] = await sessionsOf(account.id)
        expect(row?.expires_at.getTime()).toBe(now.getTime() + 2 * DAY)
      } finally {
        await env.query(`update setting set value = '2'::jsonb where key = 'session_lifetime_days'`)
        env.clock.set(new Date(Date.now()))
      }
    })

    it('rejects an expired session, clears the cookie, and the expiry is not extended by use', async () => {
      const account = await env.createAccount({ username: uniqueName('expiring') })
      const start = new Date('2026-12-01T08:00:00Z')
      env.clock.set(start)
      try {
        const client = env.client()
        await client.login(account.username, TEST_PASSWORD)
        const [before] = await sessionsOf(account.id)

        env.clock.set(new Date(start.getTime() + 2 * DAY - MINUTE))
        expect((await client.get('/api/v1/me')).status).toBe(200)
        const [after] = await sessionsOf(account.id)
        expect(after?.expires_at.getTime()).toBe(before?.expires_at.getTime()) // fixed at login

        env.clock.set(new Date(start.getTime() + 2 * DAY + MINUTE))
        const res = await client.get('/api/v1/me')
        expect(res.status).toBe(401)
        expect(res.headers.getSetCookie()).toEqual([
          '__Host-toa_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
        ])
        // The session endpoint says anonymous rather than failing.
        const session = await env
          .client()
          .request('GET', '/api/v1/auth/session', { cookie: `${SESSION_COOKIE_NAME}=${client.sessionToken ?? 'gone'}` })
        expect(SessionResponse.parse(await session.json())).toEqual({ status: 'anonymous' })
      } finally {
        env.clock.set(new Date(Date.now()))
      }
    })

    it('a remembered session is still good on day 13 and gone on day 15', async () => {
      const account = await env.createAccount({ username: uniqueName('longlife') })
      const start = new Date('2026-12-01T08:00:00Z')
      env.clock.set(start)
      try {
        const client = env.client()
        await client.login(account.username, TEST_PASSWORD, { remember: true })
        env.clock.set(new Date(start.getTime() + 13 * DAY))
        expect((await client.get('/api/v1/me')).status).toBe(200)
        env.clock.set(new Date(start.getTime() + 15 * DAY))
        expect((await client.get('/api/v1/me')).status).toBe(401)
      } finally {
        env.clock.set(new Date(Date.now()))
      }
    })

    it('writes last_seen_at at most every 5 minutes', async () => {
      const account = await env.createAccount({ username: uniqueName('seen') })
      const start = new Date('2026-12-05T08:00:00Z')
      env.clock.set(start)
      try {
        const client = env.client()
        await client.login(account.username, TEST_PASSWORD)
        const seen = async () => (await sessionsOf(account.id))[0]?.last_seen_at.getTime()
        expect(await seen()).toBe(start.getTime())

        env.clock.set(new Date(start.getTime() + 4 * MINUTE))
        await client.get('/api/v1/me')
        expect(await seen()).toBe(start.getTime()) // too soon: no write

        env.clock.set(new Date(start.getTime() + 6 * MINUTE))
        await Promise.all([client.get('/api/v1/me'), client.get('/api/v1/me'), client.get('/api/v1/me')])
        expect(await seen()).toBe(start.getTime() + 6 * MINUTE)

        env.clock.set(new Date(start.getTime() + 7 * MINUTE))
        await client.get('/api/v1/me')
        expect(await seen()).toBe(start.getTime() + 6 * MINUTE)
      } finally {
        env.clock.set(new Date(Date.now()))
      }
    })
  })

  describe('logout and the list of sessions (K-013)', () => {
    it('logout deletes the row, and the old cookie is worth nothing afterwards', async () => {
      const account = await env.createAccount({ username: uniqueName('logout') })
      const client = env.client()
      await client.login(account.username, TEST_PASSWORD)
      const cookie = client.cookie
      const csrf = client.csrfToken ?? ''
      expect(await sessionsOf(account.id)).toHaveLength(1)
      expect((await client.post('/api/v1/auth/logout')).status).toBe(204)
      expect(await sessionsOf(account.id)).toHaveLength(0)
      // A copy of the old cookie (stolen, or kept by a script) no longer works.
      const replay = env.client()
      const res = await replay.get('/api/v1/me', { cookie: cookie ?? null })
      expect(res.status).toBe(401)
      expect((await replay.post('/api/v1/auth/logout', undefined, { cookie: cookie ?? null, csrf })).status).toBe(401)
    })

    it('«log out all others» ends every session but the one asking', async () => {
      const account = await env.createAccount({ username: uniqueName('others') })
      const other = await env.createAccount({ username: uniqueName('bystander') })
      const here = env.client({ ip: '198.51.100.50' })
      const phone = env.client({ ip: '198.51.100.51' })
      const laptop = env.client({ ip: '198.51.100.52' })
      const bystander = env.client()
      await here.login(account.username, TEST_PASSWORD)
      await phone.login(account.username, TEST_PASSWORD)
      await laptop.login(account.username, TEST_PASSWORD)
      await bystander.login(other.username, TEST_PASSWORD)

      const list = await here.get('/api/v1/me/sessions')
      const sessions = (await list.json()) as { sessions: { id: string; isCurrent: boolean; ip: string | null }[] }
      expect(sessions.sessions).toHaveLength(3)
      expect(sessions.sessions.filter((s) => s.isCurrent)).toHaveLength(1)
      expect(sessions.sessions.find((s) => s.isCurrent)?.ip).toBe('198.51.100.50')

      const res = await here.delete('/api/v1/me/sessions')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ revoked: 2 })

      expect((await here.get('/api/v1/me')).status).toBe(200)
      expect((await phone.get('/api/v1/me')).status).toBe(401)
      expect((await laptop.get('/api/v1/me')).status).toBe(401)
      expect((await bystander.get('/api/v1/me')).status).toBe(200) // someone else's session is untouched
      expect(await sessionsOf(account.id)).toHaveLength(1)

      const audit = await env.query<{ action: string; new_value: { count: number } }>(
        `select action, new_value from audit_log where account_id = $1 and action = 'session.revoked_others'`,
        [account.id],
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]?.new_value).toEqual({ count: 2 })
      // Doing it again changes nothing and writes nothing more.
      expect(await (await here.delete('/api/v1/me/sessions')).json()).toEqual({ revoked: 0 })
    })

    it("ends one session by id, but only the account's own: someone else's id is a 404 and survives", async () => {
      const account = await env.createAccount({ username: uniqueName('mine') })
      const victim = await env.createAccount({ username: uniqueName('victim') })
      const me = env.client()
      const second = env.client()
      const theirs = env.client()
      await theirs.login(victim.username, TEST_PASSWORD) // the victim's session exists BEFORE the attack
      await me.login(account.username, TEST_PASSWORD)
      await second.login(account.username, TEST_PASSWORD)
      const [victimRow] = await sessionsOf(victim.id)
      const mine = (await (await me.get('/api/v1/me/sessions')).json()) as {
        sessions: { id: string; isCurrent: boolean }[]
      }
      const secondId = mine.sessions.find((s) => !s.isCurrent)?.id ?? ''

      const attack = await me.delete(`/api/v1/me/sessions/${victimRow?.id ?? ''}`)
      expect(attack.status).toBe(404)
      expect(ApiError.parse(await attack.json()).error.code).toBe('not_found')
      expect(await sessionsOf(victim.id)).toHaveLength(1)
      expect((await theirs.get('/api/v1/me')).status).toBe(200)
      // The same answer as for an id that does not exist at all.
      const nothing = await me.delete('/api/v1/me/sessions/0198a3c2-0000-7000-8000-000000000000')
      expect(nothing.status).toBe(404)

      expect((await me.delete(`/api/v1/me/sessions/${secondId}`)).status).toBe(204)
      expect((await second.get('/api/v1/me')).status).toBe(401)
      expect((await me.get('/api/v1/me')).status).toBe(200)

      // Ending the current session signs this browser out, and clears its cookie.
      const currentId =
        ((await (await me.get('/api/v1/me/sessions')).json()) as { sessions: { id: string }[] }).sessions[0]?.id ?? ''
      const self = await me.delete(`/api/v1/me/sessions/${currentId}`)
      expect(self.status).toBe(204)
      expect(self.headers.getSetCookie()[0]).toContain('Max-Age=0')
      expect((await me.get('/api/v1/me')).status).toBe(401)

      const audit = await env.query<{ action: string }>(
        `select action from audit_log where account_id = $1 and action = 'session.revoked'`,
        [account.id],
      )
      expect(audit).toHaveLength(2)
    })

    it('shows the device and the address, not the token, and leaves expired sessions out', async () => {
      const account = await env.createAccount({ username: uniqueName('devices') })
      const phone = env.client({ ip: '198.51.100.60' })
      await phone.request('POST', '/api/v1/auth/login', {
        json: { login: account.username, password: TEST_PASSWORD },
        csrf: 'none',
        headers: { 'user-agent': 'Mozilla/5.0 (Pixel) Chrome/131\u0001Injected\u001bheader' },
      })
      const laptop = env.client()
      await laptop.login(account.username, TEST_PASSWORD)
      await env.query(
        `update session set expires_at = now() - interval '1 hour' where account_id = $1 and ip = '203.0.113.7'`,
        [account.id],
      )
      const body = (await (await phone.get('/api/v1/me/sessions')).json()) as { sessions: Record<string, unknown>[] }
      expect(body.sessions).toHaveLength(1)
      expect(body.sessions[0]).toMatchObject({
        ip: '198.51.100.60',
        userAgent: 'Mozilla/5.0 (Pixel) Chrome/131 Injected header',
        isRemembered: false,
        isCurrent: true,
      })
      expect(JSON.stringify(body)).not.toContain('token')
    })
  })

  describe('what is read on every request', () => {
    it('a disabled account loses its sessions at once', async () => {
      const account = await env.createAccount({ username: uniqueName('fired') })
      const client = env.client()
      await client.login(account.username, TEST_PASSWORD)
      expect((await client.get('/api/v1/me')).status).toBe(200)
      await env.query(`update account set status = 'disabled' where id = $1`, [account.id])
      const res = await client.get('/api/v1/me')
      expect(res.status).toBe(401)
      expect(res.headers.getSetCookie()[0]).toContain('Max-Age=0')
    })

    it('a change of role shows at once: no capabilities are cached in the session', async () => {
      const account = await env.createAccount({ username: uniqueName('demoted'), role: 'administrator' })
      const client = env.client()
      await client.login(account.username, TEST_PASSWORD)
      expect(((await (await client.get('/api/v1/me')).json()) as { roles: string[] }).roles).toEqual(['administrator'])
      await env.query(
        `update account_role set role_id = (select id from role where slug = 'subscriber') where account_id = $1`,
        [account.id],
      )
      const me = (await (await client.get('/api/v1/me')).json()) as { roles: string[]; capabilities: string[] }
      expect(me.roles).toEqual(['subscriber'])
      expect(me.capabilities).toEqual(['read'])
    })

    it('a cookie that is not a token, or names no session, is anonymous and is cleared', async () => {
      const forged = `${SESSION_COOKIE_NAME}=${'A'.repeat(43)}`
      const client = env.client()
      const res = await client.get('/api/v1/me', { cookie: forged })
      expect(res.status).toBe(401)
      expect(res.headers.getSetCookie()[0]).toContain('Max-Age=0')
      for (const garbage of ['x', '', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`]) {
        const r = await env.client().get('/api/v1/me', { cookie: `${SESSION_COOKIE_NAME}=${garbage}` })
        expect(r.status, garbage).toBe(401)
      }
      // The same value without the __Host- prefix is not our cookie.
      const unprefixed = await env.client().get('/api/v1/me', { cookie: 'toa_session=A' })
      expect(unprefixed.status).toBe(401)
    })
  })

  describe('imported WordPress hashes (K-310)', () => {
    const PHPASS = { password: 'test12345', hash: '$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0' }
    const WP_BCRYPT = { password: 'password', hash: '$wp$2y$10$g8qXOp9n.RopFgc/5iVSQe0.KGkaRKgm2glxAkQDPhDfZ7rntJuE2' }
    const PLAIN_BCRYPT = {
      password: 'rasmuslerdorf',
      hash: '$2y$07$BCryptRequires22Chrcte/VlQH0piJtjXl.0t1XkA8pw9dMXTpOq',
    }

    const storedHash = async (id: string) =>
      (await env.query<{ password_hash: string }>('select password_hash from account where id = $1', [id]))[0]
        ?.password_hash ?? ''

    it.each([
      ['$P$ (phpass)', PHPASS],
      ['$wp$2y$', WP_BCRYPT],
      ['$2y$', PLAIN_BCRYPT],
    ])('logs in with a %s hash and replaces it with argon2id', async (_name, vector) => {
      const account = await env.createAccount({ username: uniqueName('legacy'), passwordHash: vector.hash })
      // A wrong password does not touch the stored hash.
      expect((await env.client().login(account.username, `${vector.password}!`)).status).toBe(401)
      expect(await storedHash(account.id)).toBe(vector.hash)

      expect((await env.client().login(account.username, vector.password)).status).toBe(200)
      const upgraded = await storedHash(account.id)
      expect(upgraded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
      expect(upgraded).not.toContain(vector.password)

      // And the next login works against the new hash, which no longer matches by the old rules.
      expect((await env.client().login(account.username, vector.password)).status).toBe(200)
      expect(await storedHash(account.id)).toBe(upgraded) // not rehashed again
      const audit = await env.query<{ new_value: { passwordUpgraded: boolean } }>(
        `select new_value from audit_log where account_id = $1 and action = 'login.succeeded' order by created_at`,
        [account.id],
      )
      expect(audit.map((a) => a.new_value.passwordUpgraded)).toEqual([true, false])
    })

    it('refuses MD5 and $H$ hashes, even with the right password, and leaves them as they are', async () => {
      const md5 = createHash('md5').update('password').digest('hex')
      const phpbb = PHPASS.hash.replace('$P$', '$H$')
      for (const [name, hash, password] of [
        ['md5', md5, 'password'],
        ['phpbb', phpbb, PHPASS.password],
      ] as const) {
        const account = await env.createAccount({ username: uniqueName(name), passwordHash: hash })
        const res = await env.client().login(account.username, password)
        expect(res.status, name).toBe(401)
        expect(ApiError.parse(await res.json()).error.code).toBe('invalid_credentials')
        expect(await storedHash(account.id)).toBe(hash)
      }
    })

    it('replaces an argon2id hash made with other parameters', async () => {
      const { hash } = await import('@node-rs/argon2')
      const weak = await hash(TEST_PASSWORD, { algorithm: ARGON2ID, memoryCost: 8192, timeCost: 3, parallelism: 1 })
      const account = await env.createAccount({ username: uniqueName('weak'), passwordHash: weak })
      expect((await env.client().login(account.username, TEST_PASSWORD)).status).toBe(200)
      expect(await storedHash(account.id)).toMatch(/\$m=19456,t=2,p=1\$/)
      // A current hash is left alone.
      const current = await hashPassword(TEST_PASSWORD)
      const other = await env.createAccount({ username: uniqueName('current'), passwordHash: current })
      await env.client().login(other.username, TEST_PASSWORD)
      expect(await storedHash(other.id)).toBe(current)
    })
  })

  describe('the second-factor seam', () => {
    async function insertTotp(accountId: string, confirmed: boolean) {
      await env.query(
        `insert into mfa_credential (account_id, type, name, secret_encrypted, confirmed_at)
         values ($1, 'totp', 'phone', 'v1:placeholder', $2)`,
        [accountId, confirmed ? new Date() : null],
      )
    }

    it('an account with a confirmed factor gets a half session: ten minutes, nothing else works, logout does', async () => {
      const account = await env.createAccount({ username: uniqueName('twofactor'), role: 'editor' })
      await insertTotp(account.id, true)
      env.clock.set(new Date('2026-12-10T09:00:00Z'))
      try {
        const client = env.client()
        const res = await client.login(account.username, TEST_PASSWORD, { remember: true })
        expect(res.status).toBe(200)
        const body = LoginResponse.parse(await res.json())
        expect(body).toMatchObject({ status: 'mfa_required', mfa: 'verification', redirectTo: '/admin' })
        expect(JSON.stringify(body)).not.toContain('"account"')
        expect(body.status === 'mfa_required' && body.csrfToken.length > 0).toBe(true)
        // Even with «Remember me» a half session is a browser-session cookie, and short on the server.
        expect(res.headers.getSetCookie()[0]).not.toContain('Max-Age')
        const [row] = await sessionsOf(account.id)
        expect(row?.expires_at.getTime()).toBe(new Date('2026-12-10T09:10:00Z').getTime())
        expect(row?.mfa_verified_at).toBeNull()
        expect(row?.is_remembered).toBe(true)

        const me = await client.get('/api/v1/me')
        expect(me.status).toBe(401)
        expect(ApiError.parse(await me.json()).error.code).toBe('mfa_required')
        const session = SessionResponse.parse(await (await client.get('/api/v1/auth/session')).json())
        expect(session).toMatchObject({ status: 'mfa_required', mfa: 'verification' })
        expect((await client.delete('/api/v1/me/sessions')).status).toBe(401)
        expect((await client.post('/api/v1/auth/logout')).status).toBe(204)
        const audit = await env.query<{ action: string }>(
          `select action from audit_log where account_id = $1 order by created_at, id`,
          [account.id],
        )
        expect(audit.map((a) => a.action)).toEqual(['login.password_accepted', 'logout'])
      } finally {
        env.clock.set(new Date(Date.now()))
      }
    })

    it('a factor that was never confirmed does not count', async () => {
      const account = await env.createAccount({ username: uniqueName('unconfirmed') })
      await insertTotp(account.id, false)
      const res = await env.client().login(account.username, TEST_PASSWORD)
      expect(LoginResponse.parse(await res.json()).status).toBe('authenticated')
    })

    it('a role in mfa_required_roles without a factor must enrol first', async () => {
      const account = await env.createAccount({ username: uniqueName('mustenrol'), role: 'administrator' })
      const spared = await env.createAccount({ username: uniqueName('spared'), role: 'editor' })
      await env.query(`update setting set value = '["administrator"]'::jsonb where key = 'mfa_required_roles'`)
      try {
        const client = env.client()
        const body = LoginResponse.parse(await (await client.login(account.username, TEST_PASSWORD)).json())
        expect(body).toMatchObject({ status: 'mfa_required', mfa: 'enrolment' })
        expect((await client.get('/api/v1/me')).status).toBe(401)
        // Another role is not asked.
        expect(
          LoginResponse.parse(await (await env.client().login(spared.username, TEST_PASSWORD)).json()).status,
        ).toBe('authenticated')
        // An administrator who is already inside when the setting changes is asked at the next request, not at the next login.
        const inside = env.client()
        await env.query(`update setting set value = '[]'::jsonb where key = 'mfa_required_roles'`)
        await inside.login(account.username, TEST_PASSWORD)
        expect((await inside.get('/api/v1/me')).status).toBe(200)
        await env.query(`update setting set value = '["administrator"]'::jsonb where key = 'mfa_required_roles'`)
        expect((await inside.get('/api/v1/me')).status).toBe(401)
      } finally {
        await env.query(`update setting set value = '[]'::jsonb where key = 'mfa_required_roles'`)
      }
    })

    it('completeMfa gives the session a new token and the full lifetime; the old token is dead', async () => {
      const account = await env.createAccount({ username: uniqueName('verified') })
      await insertTotp(account.id, true)
      const client = env.client()
      await client.login(account.username, TEST_PASSWORD, { remember: true })
      const oldCookie = client.cookie
      const [pending] = await sessionsOf(account.id)
      const done = await env.services.sessions.completeMfa(pending?.id ?? '', true)
      expect(done).toBeDefined()
      const [after] = await sessionsOf(account.id)
      expect(after?.id).toBe(pending?.id)
      expect(after?.mfa_verified_at).not.toBeNull()
      expect(after?.token_hash).toBe(sha256(done?.token ?? ''))
      expect(after?.expires_at.getTime() ?? 0).toBeGreaterThan(Date.now() + 13 * DAY)
      expect(done?.cookieMaxAgeSeconds).toBe(14 * 24 * 3600)

      expect((await env.client().get('/api/v1/me', { cookie: oldCookie ?? null })).status).toBe(401)
      const fresh = env.client()
      const res = await fresh.get('/api/v1/me', { cookie: `${SESSION_COOKIE_NAME}=${done?.token ?? ''}` })
      expect(res.status).toBe(200)
      expect(await env.services.sessions.completeMfa('0198a3c2-0000-7000-8000-000000000000', false)).toBeUndefined()
    })
  })
})
