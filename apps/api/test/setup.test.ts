// The setup wizard's API (M0.4) on a real app and PostgreSQL: the one-time token and what it guards, every step, the install
// and its concurrency and rollback, and the 404s after it. The mail itself is in setup-e2e.test.ts (a real worker and Mailpit).
import { WEAK_PASSWORD_MESSAGE, hashToken } from '@toascribe/auth'
import {
  ApiError,
  LoginResponse,
  SETUP_TOKEN_HEADER,
  SetupCheckResponse,
  SetupEmailResponse,
  SetupEmailTestResponse,
  SetupInstallResponse,
  SetupRecoveryKeyResponse,
  SetupStateResponse,
  SetupStatusResponse,
  SetupTokenVerifyResponse,
} from '@toascribe/shared'
import { createDb } from '@toascribe/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { announceSetupToken, createSetupService } from '../src/services/setup.ts'
import type { MailPort } from '../src/ports/mail.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN, memoryLogger } from './helpers.ts'
import { ADMIN, SITE, prepareInstall, resetSite, setupCall } from './setup-helpers.ts'

noticeIfSkipped('setup')

/** The routes that need the token, with a body where they take one. */
const GATED = [
  { method: 'GET', path: '/state' },
  { method: 'POST', path: '/token/verify' },
  { method: 'GET', path: '/check' },
  { method: 'PUT', path: '/site', json: SITE },
  {
    method: 'PUT',
    path: '/email',
    json: { host: 'smtp.example.test', secure: 'starttls', fromAddress: 'a@example.test' },
  },
  { method: 'POST', path: '/email/test', json: { to: 'me@example.test' } },
  { method: 'POST', path: '/email/skip' },
  { method: 'POST', path: '/recovery-key' },
  { method: 'POST', path: '/install', json: { admin: ADMIN, recoveryKey: 'x'.repeat(10), confirmed: true } },
] as const

const OpenApiPaths = z.object({ paths: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))) })

async function errorOf(res: Response) {
  return ApiError.parse(await res.json()).error
}

describe.skipIf(TEST_DATABASE_URL === undefined)('the setup API (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let ipCounter = 0
  let client: TestClient
  let token: string

  /** An address of its own for each test: the rate limits count per address. */
  function freshClient(): TestClient {
    ipCounter += 1
    return env.client({ ip: `198.51.100.${String(ipCounter)}` })
  }

  beforeAll(async () => {
    env = await startAuthApp()
  })

  afterAll(async () => {
    await env.close()
  })

  beforeEach(async () => {
    await resetSite(env)
    client = freshClient()
    token = await env.services.install.issueSetupToken()
  })

  describe('GET /setup/status', () => {
    it('is open, says only whether the site is installed and the next step, and is never cached', async () => {
      const res = await client.get('/api/v1/setup/status')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body: unknown = await res.json()
      expect(body).toEqual({ installed: false, nextStep: 'check' })
      expect(SetupStatusResponse.parse(body)).toBeTruthy()
    })

    it('follows the saved steps', async () => {
      await setupCall(client, 'PUT', '/site', token, SITE)
      expect(await (await client.get('/api/v1/setup/status')).json()).toEqual({ installed: false, nextStep: 'email' })
      await setupCall(client, 'POST', '/email/skip', token)
      expect(await (await client.get('/api/v1/setup/status')).json()).toEqual({ installed: false, nextStep: 'admin' })
    })

    it('needs no token, no Origin and no session', async () => {
      const res = await client.get('/api/v1/setup/status', { origin: null })
      expect(res.status).toBe(200)
    })
  })

  describe('the token', () => {
    it.each(GATED)('$method /setup$path without a token is refused: 401 setup_token_required', async (route) => {
      const res = await setupCall(client, route.method, route.path, undefined, 'json' in route ? route.json : undefined)
      expect(res.status).toBe(401)
      expect((await errorOf(res)).code).toBe('setup_token_required')
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it.each(GATED)('$method /setup$path with a wrong token is refused: 401 invalid_setup_token', async (route) => {
      const res = await setupCall(
        client,
        route.method,
        route.path,
        'A'.repeat(43),
        'json' in route ? route.json : undefined,
      )
      expect(res.status).toBe(401)
      expect((await errorOf(res)).code).toBe('invalid_setup_token')
    })

    it('is refused in the query string, as a cookie, and as a bearer token: only the header counts', async () => {
      for (const res of [
        await client.get(`/api/v1/setup/state?token=${token}`),
        await client.get('/api/v1/setup/state', { cookie: `token=${token}; setup_token=${token}` }),
        await client.get('/api/v1/setup/state', { headers: { authorization: `Bearer ${token}` } }),
        await client.get('/api/v1/setup/state', { headers: { 'x-setup-token-x': token } }),
      ]) {
        expect(res.status).toBe(401)
      }
    })

    it('does not open for a signed-in administrator without it', async () => {
      const account = await env.createAccount({ username: 'someone-admin', role: 'administrator' })
      const signedIn = freshClient()
      expect((await signedIn.login(account.username, TEST_PASSWORD)).status).toBe(200)
      expect((await setupCall(signedIn, 'GET', '/state', undefined)).status).toBe(401)
      expect((await signedIn.request('GET', '/api/v1/setup/state')).status).toBe(401)
    })

    it('works: the right token opens every route, and verify says where the wizard is', async () => {
      const verify = await setupCall(client, 'POST', '/token/verify', token)
      expect(verify.status).toBe(200)
      expect(SetupTokenVerifyResponse.parse(await verify.json())).toEqual({ valid: true, nextStep: 'check' })
      expect((await setupCall(client, 'GET', '/state', token)).status).toBe(200)
      expect((await setupCall(client, 'GET', '/check', token)).status).toBe(200)
    })

    it('is replaced by a new one: the old token is refused at once', async () => {
      const second = await env.services.install.issueSetupToken()
      expect((await setupCall(client, 'POST', '/token/verify', token)).status).toBe(401)
      expect((await setupCall(client, 'POST', '/token/verify', second)).status).toBe(200)
    })

    it('stores only its hash', async () => {
      const rows = await env.query<{ secret_hash: string }>(
        `select secret_hash from site_secret where purpose = 'setup_token'`,
      )
      expect(rows).toEqual([{ secret_hash: hashToken(token) }])
    })

    it('counts wrong guesses per address: after the free tries the next has to wait, even with the right token', async () => {
      await env.owner.query(`update setting set value = '3'::jsonb where key = 'login_limit_ip_attempts'`)
      const guesser = freshClient()
      for (let i = 0; i < 3; i += 1) {
        expect((await setupCall(guesser, 'POST', '/token/verify', `${'B'.repeat(42)}${String(i)}`)).status).toBe(401)
      }
      const blocked = await setupCall(guesser, 'POST', '/token/verify', token)
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
      expect((await errorOf(blocked)).code).toBe('too_many_requests')

      // Another address is not held up.
      expect((await setupCall(freshClient(), 'POST', '/token/verify', token)).status).toBe(200)
      // The wait is in its own bucket: the same address can still sign in.
      const account = await env.createAccount({ username: 'bystander', role: 'subscriber' })
      expect((await guesser.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('does not let the wizard’s own, right requests use up the allowance', async () => {
      await env.owner.query(`update setting set value = '3'::jsonb where key = 'login_limit_ip_attempts'`)
      const wizard = freshClient()
      for (let i = 0; i < 12; i += 1) {
        expect((await setupCall(wizard, 'GET', '/state', token)).status).toBe(200)
      }
    })

    it('holds up many guesses made at once, not just one after another', async () => {
      await env.owner.query(`update setting set value = '5'::jsonb where key = 'login_limit_ip_attempts'`)
      const guesser = freshClient()
      const statuses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          setupCall(guesser, 'GET', '/state', `${'C'.repeat(40)}${String(i).padStart(3, '0')}`),
        ),
      ).then((responses) => responses.map((r) => r.status))
      expect(statuses.filter((s) => s === 401)).toHaveLength(5)
      expect(statuses.filter((s) => s === 429)).toHaveLength(25)
    })
  })

  describe('where a request comes from', () => {
    it('refuses a state-changing request from another site, even with the right token', async () => {
      const res = await setupCall(client, 'PUT', '/site', token, SITE, { origin: 'https://evil.example' })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('origin_invalid')
      expect(await env.query(`select 1 from setting where key = 'blogname' and value <> '""'::jsonb`)).toHaveLength(0)
    })

    it('refuses one with no Origin and no Sec-Fetch-Site, and one that is not JSON', async () => {
      expect((await setupCall(client, 'POST', '/email/skip', token, undefined, { origin: null })).status).toBe(400)
      const form = await client.request('PUT', '/api/v1/setup/site', {
        csrf: 'none',
        body: 'title=x',
        contentType: 'application/x-www-form-urlencoded',
        headers: { [SETUP_TOKEN_HEADER]: token },
      })
      expect(form.status).toBe(400)
      expect((await errorOf(form)).code).toBe('unsupported_media_type')
    })

    it('answers a read from the wizard without an Origin (a same-origin GET carries none)', async () => {
      const res = await setupCall(client, 'GET', '/state', token, undefined, { origin: null })
      expect(res.status).toBe(200)
    })

    it('needs no CSRF token: the setup token takes its place', async () => {
      const res = await client.request('POST', '/api/v1/setup/token/verify', {
        csrf: 'none',
        headers: { [SETUP_TOKEN_HEADER]: token },
      })
      expect(res.status).toBe(200)
    })
  })

  describe('the steps', () => {
    it('GET /setup/check reports the system, never a key, and PUBLIC_ORIGIN against the browser', async () => {
      // A same-origin GET carries a Referer and no Origin.
      const res = await setupCall(client, 'GET', '/check', token, undefined, {
        headers: { referer: `${TEST_ORIGIN}/admin/setup` },
        origin: null,
      })
      expect(res.status).toBe(200)
      const check = SetupCheckResponse.parse(await res.json())
      expect(check).toMatchObject({
        ok: true,
        database: { ok: true },
        migrations: { ok: true },
        encryptionKey: { ok: true, version: 1 },
        signingKey: { ok: true },
        origin: { ok: true, configured: TEST_ORIGIN, observed: TEST_ORIGIN, source: 'referer' },
      })
      expect(['watching', 'ok']).toContain(check.proxy.state)
      const text = JSON.stringify(check)
      expect(text).not.toContain('1f2e3d4c')
      expect(text).not.toContain('a1b2c3d4')
    })

    it('GET /setup/check reports a PUBLIC_ORIGIN that is not the address in the browser, with both values', async () => {
      const res = await setupCall(client, 'GET', '/check', token, undefined, {
        headers: { referer: 'http://localhost:8080/admin/setup?token=abc' },
        origin: null,
      })
      const check = SetupCheckResponse.parse(await res.json())
      expect(check.ok).toBe(false)
      expect(check.origin).toEqual({
        ok: false,
        configured: TEST_ORIGIN,
        observed: 'http://localhost:8080',
        source: 'referer',
      })
      // The same through the proxy's headers.
      const proxied = await setupCall(client, 'GET', '/check', token, undefined, {
        headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'cms.example.test', host: 'api:3001' },
        origin: null,
      })
      expect(SetupCheckResponse.parse(await proxied.json()).origin).toMatchObject({
        ok: false,
        observed: 'http://cms.example.test',
        source: 'forwarded',
      })
    })

    it('PUT /setup/site saves the step and PUT /setup/email saves the server, and a reload finds both', async () => {
      const site = await setupCall(client, 'PUT', '/site', token, SITE)
      expect(site.status).toBe(200)
      expect(await site.json()).toEqual({ site: SITE, nextStep: 'email' })

      const email = await setupCall(client, 'PUT', '/email', token, {
        host: 'smtp.example.test',
        port: 587,
        secure: 'starttls',
        username: 'mailer',
        password: 'smtp-secret-pw',
        fromAddress: 'noreply@cms.example.test',
        fromName: 'Min blogg',
      })
      expect(email.status).toBe(200)
      const saved = SetupEmailResponse.parse(await email.json())
      expect(saved).toEqual({
        email: {
          host: 'smtp.example.test',
          port: 587,
          secure: 'starttls',
          username: 'mailer',
          smtpPasswordSet: true,
          fromAddress: 'noreply@cms.example.test',
          fromName: 'Min blogg',
        },
        // Saved, not tested: the step is not done until a test mail goes through, or it is skipped.
        nextStep: 'email',
      })

      const state = await setupCall(client, 'GET', '/state', token)
      const body = SetupStateResponse.parse(await state.json())
      expect(body.site).toEqual(SITE)
      expect(body.email).toEqual(saved.email)
      expect(body.nextStep).toBe('email')
      // The password is in no response and in no table in the clear.
      for (const text of [JSON.stringify(saved), JSON.stringify(body)]) {
        expect(text).not.toContain('smtp-secret-pw')
      }
      const stored = await env.query<{ value: string }>(`select value from setting where key = 'smtp_password'`)
      expect(JSON.stringify(stored)).toMatch(/v1:/)
      expect(JSON.stringify(stored)).not.toContain('smtp-secret-pw')
    })

    it('refuses a step that does not pass its schema with 400 and the fields, not the values', async () => {
      for (const [path, bad] of [
        ['/site', { ...SITE, timezone: 'Mars/Olympus' }],
        ['/site', { ...SITE, title: '' }],
        ['/site', { ...SITE, extra: 1 }],
        ['/email', { host: 'x y', secure: 'starttls', fromAddress: 'a@example.test' }],
        ['/email', { host: 'smtp.example.test', secure: 'ssl', fromAddress: 'a@example.test' }],
        ['/email/test', { to: 'nope' }],
      ] as const) {
        const res = await setupCall(client, 'PUT', path, token, bad)
        // /email/test is a POST; the others are PUTs. A wrong method is 404, so use the right one.
        const real = path === '/email/test' ? await setupCall(client, 'POST', path, token, bad) : res
        expect(real.status, path).toBe(400)
        expect((await errorOf(real)).code).toBe('validation_error')
      }
    })

    it('POST /setup/email/skip stores the notice the dashboard shows later', async () => {
      const res = await setupCall(client, 'POST', '/email/skip', token)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ skipped: true, nextStep: 'check' })
      const rows = await env.query<{ key: string; level: string; message_key: string; dismissed_at: string | null }>(
        'select key, level, message_key, dismissed_at from admin_notice',
      )
      expect(rows).toEqual([
        { key: 'setup.email_skipped', level: 'warning', message_key: 'notices.setupEmailSkipped', dismissed_at: null },
      ])
    })

    it('POST /setup/recovery-key gives a key that is not stored, and a new one replaces it', async () => {
      const first = SetupRecoveryKeyResponse.parse(
        await (await setupCall(client, 'POST', '/recovery-key', token)).json(),
      )
      const second = SetupRecoveryKeyResponse.parse(
        await (await setupCall(client, 'POST', '/recovery-key', token)).json(),
      )
      expect(first.recoveryKey).not.toBe(second.recoveryKey)
      const dump = JSON.stringify(await env.query('select * from site_secret'))
      expect(dump).not.toContain(first.recoveryKey)
      expect(dump).not.toContain(second.recoveryKey.replaceAll('-', ''))
    })

    it('POST /setup/email/test says queue_unavailable where there is no queue to ask', async () => {
      // The default mail of these tests records and cannot tell how a job ended.
      const res = await setupCall(client, 'POST', '/email/test', token, { to: 'me@example.test' })
      expect(res.status).toBe(200)
      expect(SetupEmailTestResponse.parse(await res.json())).toEqual({ ok: false, error: 'queue_unavailable' })
    })
  })

  describe('the test mail with a queue', () => {
    function queue(outcome: { state: string; output?: unknown }): MailPort & { sent: unknown[] } {
      const sent: unknown[] = []
      return {
        sent,
        sendMail(request, options) {
          sent.push({ request, options })
          return Promise.resolve({ jobId: 'job-9' })
        },
        jobState() {
          return Promise.resolve({ state: outcome.state, output: outcome.output ?? null })
        },
      }
    }

    it('succeeds only when the job completed, and failures give a code and nothing else', async () => {
      const completed = queue({ state: 'completed', output: { sent: true } })
      const ok = env.variant({ mail: completed }).client({ ip: '198.51.100.201' })
      const okRes = await setupCall(ok, 'POST', '/email/test', token, { to: 'me@example.test' })
      expect(SetupEmailTestResponse.parse(await okRes.json())).toEqual({ ok: true })
      expect(completed.sent).toHaveLength(1)

      const failed = queue({ state: 'failed', output: { error: 'mail_config' } })
      const bad = env.variant({ mail: failed }).client({ ip: '198.51.100.202' })
      const badRes = await setupCall(bad, 'POST', '/email/test', token, { to: 'me@example.test' })
      expect(SetupEmailTestResponse.parse(await badRes.json())).toEqual({ ok: false, error: 'mail_config' })
    })
  })

  describe('the install', () => {
    async function install(c: TestClient, key: string, overrides: Record<string, unknown> = {}) {
      return setupCall(c, 'POST', '/install', token, { admin: ADMIN, recoveryKey: key, confirmed: true, ...overrides })
    }

    it('installs the site, signs the administrator in, and closes the wizard', async () => {
      const key = await prepareInstall(client, token)
      const res = await install(client, key)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = SetupInstallResponse.parse(await res.json())
      expect(body.installed).toBe(true)
      expect(body.login).toMatchObject({
        status: 'authenticated',
        redirectTo: '/admin',
        account: { username: 'tor', email: 'tor@example.test', roles: ['administrator'] },
      })
      expect(LoginResponse.parse(body.login).status).toBe('authenticated')

      // The cookie is the session of a normal login: it works for /me, and the CSRF token it came with works for a change.
      const setCookie = res.headers.getSetCookie().find((line) => line.startsWith('__Host-toa_session='))
      expect(setCookie).toMatch(/HttpOnly/i)
      expect(setCookie).toMatch(/Secure/i)
      expect(setCookie).toMatch(/SameSite=Lax/i)
      expect(setCookie).toMatch(/Path=\//i)
      const me = await client.get('/api/v1/me')
      expect(me.status).toBe(200)
      const csrf = body.login?.csrfToken
      const patched = await client.patch('/api/v1/me', { nickname: 'Tor' }, { csrf: csrf ?? 'none' })
      expect(patched.status).toBe(200)
      const unprotected = await client.patch('/api/v1/me', { nickname: 'Tor' }, { csrf: 'none' })
      expect(unprotected.status).toBe(403)

      // The data: one administrator, the content, the flag, no token, a recovery verifier.
      expect(await env.query<{ username: string }>('select username from account')).toEqual([{ username: 'tor' }])
      expect(await env.query<{ title: string }>(`select title from content order by short_id`)).toEqual([
        { title: 'Hei, verden!' },
        { title: 'Testside' },
        { title: 'Personvernerklæring' },
      ])
      expect((await env.query<{ value: boolean }>(`select value from setting where key = 'installed'`))[0]?.value).toBe(
        true,
      )
      expect((await env.query<{ purpose: string }>('select purpose from site_secret')).map((r) => r.purpose)).toEqual([
        'backup_recovery_key',
      ])
      const audit = await env.query<{ action: string; source: string }>(
        `select action, source from audit_log where action in ('site.installed', 'login.succeeded') order by action`,
      )
      expect(audit).toEqual([
        { action: 'login.succeeded', source: 'api' },
        { action: 'site.installed', source: 'setup' },
      ])
    })

    it('lets the first administrator sign in again with the password chosen', async () => {
      const key = await prepareInstall(client, token)
      expect((await install(client, key)).status).toBe(200)
      const fresh = freshClient()
      const login = await fresh.login('tor', ADMIN.password)
      expect(login.status).toBe(200)
      expect(await fresh.login('tor@example.test', ADMIN.password)).toHaveProperty('status', 200)
      expect((await freshClient().login('tor', 'wrong password')).status).toBe(401)
    })

    it('answers 404 on every setup route afterwards, with and without the old token, and the status says installed', async () => {
      const key = await prepareInstall(client, token)
      expect((await install(client, key)).status).toBe(200)

      for (const route of GATED) {
        for (const sent of [token, undefined, 'A'.repeat(43)]) {
          const res = await setupCall(
            freshClient(),
            route.method,
            route.path,
            sent,
            'json' in route ? route.json : undefined,
          )
          expect(res.status, `${route.method} ${route.path} with ${sent === undefined ? 'no token' : 'a token'}`).toBe(
            404,
          )
          expect((await errorOf(res)).code).toBe('not_found')
        }
      }
      // Not a 404 for a request from another site either: the answer never depends on what is sent.
      expect(
        (await setupCall(freshClient(), 'PUT', '/site', token, SITE, { origin: 'https://evil.example' })).status,
      ).toBe(404)

      const status = await freshClient().get('/api/v1/setup/status')
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({ installed: true, nextStep: null })

      // The token is gone from the database, and the wrong guesses above were not even counted.
      expect(await env.query(`select 1 from site_secret where purpose = 'setup_token'`)).toHaveLength(0)
      expect(await env.query(`select 1 from login_attempt where action = 'setup' and succeeded = false`)).toHaveLength(
        0,
      )
    })

    it('stays closed after a restart: a new app on the same database answers 404 too', async () => {
      const key = await prepareInstall(client, token)
      expect((await install(client, key)).status).toBe(200)
      const restarted = env.variant({}).client({ ip: '198.51.100.230' })
      expect((await setupCall(restarted, 'POST', '/token/verify', token)).status).toBe(404)
      expect(await (await restarted.get('/api/v1/setup/status')).json()).toEqual({ installed: true, nextStep: null })
    })

    it('lets exactly one of two installs at once win: one 200, one 409 already_installed, one administrator, one set of content', async () => {
      const key = await prepareInstall(client, token)
      const [a, b] = await Promise.all([
        install(freshClient(), key, { admin: { ...ADMIN, username: 'anna', email: 'anna@example.test' } }),
        install(freshClient(), key, { admin: { ...ADMIN, username: 'bjorn', email: 'bjorn@example.test' } }),
      ])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      const loser = a.status === 409 ? a : b
      expect((await errorOf(loser)).code).toBe('already_installed')
      expect(loser.headers.getSetCookie()).toEqual([])

      expect(await env.query('select 1 from account')).toHaveLength(1)
      expect(await env.query(`select 1 from content where slug = 'hei-verden'`)).toHaveLength(1)
      expect(await env.query('select 1 from content')).toHaveLength(3)
      expect(await env.query('select 1 from comment')).toHaveLength(1)
      expect(await env.query(`select 1 from audit_log where action = 'site.installed'`)).toHaveLength(1)
      expect(await env.query('select 1 from session')).toHaveLength(1)
    })

    it('needs confirmed: true, and the key', async () => {
      const key = await prepareInstall(client, token)
      for (const overrides of [
        { confirmed: false },
        { confirmed: undefined },
        { confirmed: 'true' },
        { recoveryKey: undefined },
      ]) {
        const res = await install(client, key, overrides)
        expect(res.status, JSON.stringify(overrides)).toBe(400)
        expect((await errorOf(res)).code).toBe('validation_error')
      }
      expect(await env.query('select 1 from account')).toHaveLength(0)
    })

    it('refuses a recovery key that is not the one made last: 400 recovery_key_mismatch, nothing written', async () => {
      const first = await prepareInstall(client, token)
      const second = SetupRecoveryKeyResponse.parse(
        await (await setupCall(client, 'POST', '/recovery-key', token)).json(),
      )
      const stale = await install(client, first)
      expect(stale.status).toBe(400)
      expect((await errorOf(stale)).code).toBe('recovery_key_mismatch')
      expect(await env.query('select 1 from account')).toHaveLength(0)
      expect((await install(client, second.recoveryKey)).status).toBe(200)
    })

    it('answers 409 step_missing before the site and e-mail steps are saved', async () => {
      const key = SetupRecoveryKeyResponse.parse(await (await setupCall(client, 'POST', '/recovery-key', token)).json())
      const noSite = await install(client, key.recoveryKey)
      expect(noSite.status).toBe(409)
      expect((await errorOf(noSite)).code).toBe('step_missing')
      await setupCall(client, 'PUT', '/site', token, SITE)
      const noEmail = await install(client, key.recoveryKey)
      expect(noEmail.status).toBe(409)
      expect((await errorOf(noEmail)).message).toContain('e-mail')
    })

    it('refuses a weak or malformed administrator before it touches the database', async () => {
      const key = await prepareInstall(client, token)
      for (const admin of [
        { ...ADMIN, password: 'short' },
        { ...ADMIN, username: 'a b' },
        { ...ADMIN, email: 'nope' },
        { ...ADMIN, role: 'administrator' },
      ]) {
        const res = await install(client, key, { admin })
        expect(res.status).toBe(400)
        expect(JSON.stringify(await res.json())).not.toContain('short')
      }
    })

    it('answers 400 weak_password for a password equal to the username or the address, writes nothing and keeps the token', async () => {
      const key = await prepareInstall(client, token)
      for (const password of [
        'administrator',
        'ADMINISTRATOR',
        'administrator@example.test',
        'Administrator@Example.TEST',
      ]) {
        const res = await install(client, key, {
          admin: { username: 'administrator', email: 'administrator@example.test', password },
        })
        expect(res.status, password).toBe(400)
        const error = await errorOf(res)
        expect(error.code).toBe('weak_password')
        expect(error.message).toBe(WEAK_PASSWORD_MESSAGE)
        expect(res.headers.getSetCookie()).toEqual([])
      }
      expect(await env.query('select 1 from account')).toHaveLength(0)
      expect(await env.query('select 1 from content')).toHaveLength(0)
      expect((await env.query<{ value: boolean }>(`select value from setting where key = 'installed'`))[0]?.value).toBe(
        false,
      )
      expect((await setupCall(client, 'POST', '/token/verify', token)).status).toBe(200)
      // A password that is not the username installs.
      expect((await install(client, key)).status).toBe(200)
    })

    it('rolls back all of it when the e-mail address is taken, and the token still works', async () => {
      const key = await prepareInstall(client, token)
      await env.createAccount({ username: 'already', email: ADMIN.email, role: 'subscriber' })
      const res = await install(client, key)
      expect(res.status).toBe(409)
      expect((await errorOf(res)).code).toBe('email_taken')
      expect(res.headers.getSetCookie()).toEqual([])

      expect(await env.query('select 1 from account')).toHaveLength(1)
      expect(await env.query('select 1 from content')).toHaveLength(0)
      expect(await env.query('select 1 from session')).toHaveLength(0)
      expect((await env.query<{ value: boolean }>(`select value from setting where key = 'installed'`))[0]?.value).toBe(
        false,
      )
      expect(await env.query(`select 1 from audit_log where action = 'site.installed'`)).toHaveLength(0)
      expect((await setupCall(client, 'POST', '/token/verify', token)).status).toBe(200)

      // The person corrects the address and goes on.
      const retry = await install(client, key, { admin: { ...ADMIN, email: 'tor.angeltveit@example.test' } })
      expect(retry.status).toBe(200)
    })

    it('rolls back the administrator when the default content cannot be made', async () => {
      const key = await prepareInstall(client, token)
      // A page with the address of the sample page is there already: the seed refuses after the account was inserted.
      await env.owner.query(
        `insert into content (type, slug, title, status, locale, comment_status, blocks) values ('page', 'testside', 'Min egen', 'draft', 'nb', 'closed', '[]'::jsonb)`,
      )
      const res = await install(client, key)
      expect(res.status).toBe(409)
      expect((await errorOf(res)).code).toBe('content_exists')
      expect(await env.query('select 1 from account')).toHaveLength(0)
      expect(await env.query('select 1 from content')).toHaveLength(1)
      expect((await env.query<{ value: boolean }>(`select value from setting where key = 'installed'`))[0]?.value).toBe(
        false,
      )
    })

    it('installs the site although the session cannot be made, and says so with login: null', async () => {
      const key = await prepareInstall(client, token)
      const { db, pool } = createDb({ connectionString: env.database.appUrl, max: 2 })
      try {
        const broken = createSetupService({
          db,
          install: env.services.install,
          sessions: { ...env.services.sessions, issue: () => Promise.reject(new Error('no sessions today')) },
          clock: env.clock.now,
          logger: memoryLogger().logger,
        })
        const result = await broken.install(
          { admin: ADMIN, recoveryKey: key, confirmed: true },
          { ip: '198.51.100.240', requestId: 'r1', userAgent: null },
        )
        expect(result).toEqual({ login: null, issued: null })
      } finally {
        await pool.end()
      }
      expect(await env.query('select 1 from account')).toHaveLength(1)
      expect(await env.query('select 1 from session')).toHaveLength(0)
      expect((await env.query<{ value: boolean }>(`select value from setting where key = 'installed'`))[0]?.value).toBe(
        true,
      )
    })
  })

  describe('the token in the log', () => {
    it('is written once, at warn, in the address to open, and nowhere else', async () => {
      await resetSite(env)
      const { logger, lines } = memoryLogger()
      const issued =
        (await announceSetupToken({ install: env.services.install, logger, publicOrigin: TEST_ORIGIN })) ?? ''
      expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const text = JSON.stringify(lines)
      expect(text.split(issued).length - 1).toBe(1)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ level: 40 })
      expect(String(lines[0]?.['msg'])).toContain(`${TEST_ORIGIN}/admin/setup#token=${issued}`)
      // And it is the token that works.
      const c = freshClient()
      expect((await setupCall(c, 'POST', '/token/verify', issued)).status).toBe(200)
    })

    it('makes a new one at every start and the old one stops working; an installed site gets none', async () => {
      const first = await announceSetupToken({
        install: env.services.install,
        logger: memoryLogger().logger,
        publicOrigin: TEST_ORIGIN,
      })
      const second = await announceSetupToken({
        install: env.services.install,
        logger: memoryLogger().logger,
        publicOrigin: TEST_ORIGIN,
      })
      expect(first).not.toBe(second)
      expect((await setupCall(freshClient(), 'POST', '/token/verify', first)).status).toBe(401)
      expect((await setupCall(freshClient(), 'POST', '/token/verify', second)).status).toBe(200)

      const key = await prepareInstall(freshClient(), second ?? '')
      expect((await install2(freshClient(), second ?? '', key)).status).toBe(200)
      const quiet = memoryLogger()
      expect(
        await announceSetupToken({ install: env.services.install, logger: quiet.logger, publicOrigin: TEST_ORIGIN }),
      ).toBeUndefined()
      expect(quiet.lines).toHaveLength(0)
    })

    it('does not reach the api’s own log through any request, answer or error', async () => {
      const key = await prepareInstall(client, token)
      await setupCall(client, 'GET', '/check', token)
      await setupCall(client, 'PUT', '/site', token, { ...SITE, timezone: 'bad' })
      await setupCall(client, 'GET', '/state', 'A'.repeat(43))
      await install2(client, token, key)
      const text = JSON.stringify(env.lines)
      expect(text).not.toContain(token)
      expect(text).not.toContain(key)
      expect(text).not.toContain(ADMIN.password)
    })
  })

  describe('the documentation of the routes', () => {
    it('lists each setup route with its policy in the OpenAPI document', async () => {
      const doc = OpenApiPaths.parse(await (await client.get('/api/v1/openapi.json')).json())
      expect(doc.paths['/api/v1/setup/status']?.['get']?.['x-policy']).toBe('public')
      for (const route of GATED) {
        expect(
          doc.paths[`/api/v1/setup${route.path}`]?.[route.method.toLowerCase()]?.['x-policy'],
          `${route.method} ${route.path}`,
        ).toBe('setup-token')
      }
      expect(JSON.stringify(doc)).not.toContain(token)
    })
  })

  async function install2(c: TestClient, withToken: string, key: string) {
    return setupCall(c, 'POST', '/install', withToken, { admin: ADMIN, recoveryKey: key, confirmed: true })
  }
})
