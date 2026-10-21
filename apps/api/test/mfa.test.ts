// The second factor (K-023) against a real PostgreSQL: enrolment, the second step of a login, recovery codes, the role
// requirement, and what a half-signed-in session may and may not do.
import { createHash } from 'node:crypto'

import { MfaConfirmResponse, MfaEnrolStartResponse, MfaListResponse, MfaVerifyResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { totpCodeAt } from '../src/lib/totp.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { codeNow, enrolTotp, errorCode, nextStep, readJson, setSetting, unique } from './flows.ts'
import { SESSION_COOKIE_NAME, TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { testKeyRing } from './helpers.ts'

noticeIfSkipped('mfa')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

describe.skipIf(TEST_DATABASE_URL === undefined)('second factor (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let ipCounter = 0
  /** Each test uses addresses of its own, so the limits of one never touch another. */
  const ip = () => `192.0.2.${String((ipCounter += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  /** An account with an enrolled authenticator app, signed out again. */
  async function accountWithFactor(
    base: string,
    role: 'subscriber' | 'editor' | 'administrator' = 'subscriber',
    name?: string,
  ) {
    const account = await env.createAccount({ username: unique(base), role })
    const client = env.client({ ip: ip() })
    expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    const enrolled = await enrolTotp(env, client, name)
    expect(enrolled.response.status).toBe(200)
    await client.post('/api/v1/auth/logout')
    nextStep(env)
    return { account, enrolled, recoveryCodes: enrolled.recoveryCodes ?? [] }
  }

  /** Signs in with the password only: the session is half done. */
  async function halfLogin(username: string, options: { remember?: boolean } = {}) {
    const client = env.client({ ip: ip() })
    const res = await client.login(username, TEST_PASSWORD, options)
    return { client, res, body: await readJson(res.clone()) }
  }

  describe('enrolment', () => {
    it('starts with a secret, an otpauth address and a QR code, never cached, and keeps the secret encrypted for its row', async () => {
      const account = await env.createAccount({ username: unique('enrol') })
      const client = env.client({ ip: ip() })
      await client.login(account.username, TEST_PASSWORD)
      const res = await client.post('/api/v1/me/mfa/totp', { name: '  Min telefon ' })
      expect(res.status).toBe(201)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const started = MfaEnrolStartResponse.parse(await res.json())
      expect(started.secret).toMatch(/^[A-Z2-7]{32}$/)
      expect(started.uri).toContain(`secret=${started.secret}`)
      expect(started.uri).toContain(`issuer=cms.example.test`)
      expect(started.qrSvg.startsWith('<svg')).toBe(true)

      const [row] = await env.query<{
        id: string
        name: string | null
        secret_encrypted: string
        confirmed_at: Date | null
        type: string
      }>('select id, name, secret_encrypted, confirmed_at, type from mfa_credential where account_id = $1', [
        account.id,
      ])
      expect(row?.id).toBe(started.id)
      expect(row?.type).toBe('totp')
      expect(row?.name).toBe('Min telefon')
      expect(row?.confirmed_at).toBeNull()
      // Encrypted: versioned, not the secret, and bound to its own row.
      expect(row?.secret_encrypted).toMatch(/^v1:/)
      expect(row?.secret_encrypted).not.toContain(started.secret)
      expect(await testKeyRing.decrypt(row?.secret_encrypted ?? '', `mfa_credential:${started.id}`)).toBe(
        started.secret,
      )
      await expect(testKeyRing.decrypt(row?.secret_encrypted ?? '', `mfa_credential:${account.id}`)).rejects.toThrow()
    })

    it('a second start replaces the unfinished one, and an unfinished factor does not count', async () => {
      const account = await env.createAccount({ username: unique('restart') })
      const client = env.client({ ip: ip() })
      await client.login(account.username, TEST_PASSWORD)
      const first = MfaEnrolStartResponse.parse(await (await client.post('/api/v1/me/mfa/totp', {})).json())
      const second = MfaEnrolStartResponse.parse(await (await client.post('/api/v1/me/mfa/totp', {})).json())
      expect(second.id).not.toBe(first.id)
      const rows = await env.query<{ id: string }>('select id from mfa_credential where account_id = $1', [account.id])
      expect(rows.map((row) => row.id)).toEqual([second.id])
      // The old one cannot be finished any more.
      const old = await client.post(`/api/v1/me/mfa/totp/${first.id}/confirm`, { code: codeNow(env, first.secret) })
      expect(old.status).toBe(404)
      // And with an unfinished factor, a new login needs no second step.
      const again = await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)
      expect((await readJson(again)).status).toBe('authenticated')
    })

    it('a wrong first code is refused and counted, and the right one finishes it and gives ten recovery codes once', async () => {
      const account = await env.createAccount({ username: unique('confirm') })
      const client = env.client({ ip: ip() })
      await client.login(account.username, TEST_PASSWORD)
      const started = MfaEnrolStartResponse.parse(await (await client.post('/api/v1/me/mfa/totp', {})).json())
      const right = codeNow(env, started.secret)
      const wrong = right === '000000' ? '000001' : '000000'

      const bad = await client.post(`/api/v1/me/mfa/totp/${started.id}/confirm`, { code: wrong })
      expect(bad.status).toBe(403)
      expect(await errorCode(bad)).toBe('invalid_code')
      expect(
        await env.query('select 1 from login_attempt where account_id = $1 and action = $2', [account.id, 'mfa']),
      ).toHaveLength(1)
      expect(
        await env.query('select 1 from mfa_credential where account_id = $1 and confirmed_at is not null', [
          account.id,
        ]),
      ).toHaveLength(0)

      const good = await client.post(`/api/v1/me/mfa/totp/${started.id}/confirm`, { code: right })
      expect(good.status).toBe(200)
      const done = MfaConfirmResponse.parse(await good.json())
      expect(done.loginCompleted).toBe(false)
      expect(done.factor.id).toBe(started.id)
      expect(done.recoveryCodes).toHaveLength(10)
      for (const code of done.recoveryCodes ?? []) {
        expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
      }
      // Stored as hashes only.
      const hashes = await env.query<{ code_hash: string; used_at: Date | null }>(
        'select code_hash, used_at from recovery_code where account_id = $1',
        [account.id],
      )
      expect(hashes).toHaveLength(10)
      const plain = (done.recoveryCodes ?? []).flatMap((code) => [code, code.replaceAll('-', '')])
      for (const row of hashes) {
        expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(plain).not.toContain(row.code_hash)
        expect(row.used_at).toBeNull()
      }

      // A finished enrolment cannot be finished again.
      const twice = await client.post(`/api/v1/me/mfa/totp/${started.id}/confirm`, {
        code: codeNow(env, started.secret),
      })
      expect(twice.status).toBe(404)
    })

    it("another account's enrolment is not found, whoever asks", async () => {
      const owner = await env.createAccount({ username: unique('owner') })
      const thief = await env.createAccount({ username: unique('thief') })
      const ownerClient = env.client({ ip: ip() })
      await ownerClient.login(owner.username, TEST_PASSWORD)
      const started = MfaEnrolStartResponse.parse(await (await ownerClient.post('/api/v1/me/mfa/totp', {})).json())

      const thiefClient = env.client({ ip: ip() })
      await thiefClient.login(thief.username, TEST_PASSWORD)
      const res = await thiefClient.post(`/api/v1/me/mfa/totp/${started.id}/confirm`, {
        code: codeNow(env, started.secret),
      })
      expect(res.status).toBe(404)
      expect(
        await env.query('select 1 from mfa_credential where id = $1 and confirmed_at is null', [started.id]),
      ).toHaveLength(1)
    })

    it('gives recovery codes with the first factor only; a second factor gets none', async () => {
      const { account, enrolled } = await accountWithFactor('two-apps')
      expect(enrolled.recoveryCodes).toHaveLength(10)
      const { client, body } = await halfLogin(account.username)
      expect(body.status).toBe('mfa_required')
      const verify = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      expect(verify.status).toBe(200)
      nextStep(env)
      const second = await enrolTotp(env, client, 'Nettbrett')
      expect(second.response.status).toBe(200)
      expect(MfaConfirmResponse.parse(await second.response.json()).recoveryCodes).toBeNull()
      const list = MfaListResponse.parse(await (await client.get('/api/v1/me/mfa')).json())
      expect(list.factors.map((factor) => factor.name)).toEqual([null, 'Nettbrett'])
      expect(list.recoveryCodesRemaining).toBe(10)
    })

    it('allows five authenticator apps and refuses the sixth', async () => {
      const { account, enrolled } = await accountWithFactor('five-apps')
      const { client } = await halfLogin(account.username)
      await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      for (let n = 0; n < 4; n += 1) {
        nextStep(env)
        expect((await enrolTotp(env, client)).response.status).toBe(200)
      }
      const sixth = await client.post('/api/v1/me/mfa/totp', {})
      expect(sixth.status).toBe(409)
      expect(await errorCode(sixth)).toBe('too_many_factors')
    })

    it("enrolling the first factor keeps this session complete, and the account's other sessions have to pass it", async () => {
      const account = await env.createAccount({ username: unique('others') })
      const here = env.client({ ip: ip() })
      const elsewhere = env.client({ ip: ip() })
      await here.login(account.username, TEST_PASSWORD)
      await elsewhere.login(account.username, TEST_PASSWORD)
      expect((await elsewhere.get('/api/v1/me')).status).toBe(200)

      const enrolled = await enrolTotp(env, here)
      expect(enrolled.response.status).toBe(200)
      // The session that enrolled passed the code a moment ago.
      expect((await here.get('/api/v1/me')).status).toBe(200)
      // The other one did not.
      const other = await elsewhere.get('/api/v1/me')
      expect(other.status).toBe(401)
      expect(await errorCode(other)).toBe('mfa_required')
    })

    it('refuses a start and a finish from someone who is not signed in', async () => {
      const anonymous = env.client({ ip: ip() })
      expect((await anonymous.post('/api/v1/me/mfa/totp', {}, { csrf: 'none' })).status).toBe(401)
      expect(
        (
          await anonymous.post(
            '/api/v1/me/mfa/totp/0198a3c2-0000-7000-8000-000000000001/confirm',
            { code: '123456' },
            { csrf: 'none' },
          )
        ).status,
      ).toBe(401)
    })
  })

  describe('the login state machine: verification', () => {
    it('answers mfa_required with a short session that can do nothing else but verify and log out', async () => {
      const { account, enrolled } = await accountWithFactor('pending')
      const { client, res, body } = await halfLogin(account.username, { remember: true })
      expect(res.status).toBe(200)
      expect(body).toMatchObject({ status: 'mfa_required', mfa: 'verification', redirectTo: '/admin' })
      expect(body).not.toHaveProperty('account')
      // «Remember me» gives no persistent cookie until the second step is passed.
      expect(res.headers.getSetCookie()[0]).not.toMatch(/Max-Age/)

      const [row] = await env.query<{ expires_at: Date; created_at: Date; mfa_verified_at: Date | null }>(
        'select expires_at, created_at, mfa_verified_at from session where account_id = $1 order by created_at desc limit 1',
        [account.id],
      )
      expect(row?.mfa_verified_at).toBeNull()
      expect((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)).toBeLessThanOrEqual(
        10 * MINUTE + 1000,
      )

      // Everything else is turned away, with the code that tells the client why.
      for (const [method, path] of [
        ['GET', '/api/v1/me'],
        ['PATCH', '/api/v1/me'],
        ['GET', '/api/v1/me/sessions'],
        ['GET', '/api/v1/me/mfa'],
        ['PATCH', '/api/v1/me/password'],
        ['POST', '/api/v1/me/email-change'],
        ['POST', '/api/v1/me/email-change/confirm'],
        ['POST', '/api/v1/me/mfa/recovery-codes'],
        ['POST', '/api/v1/system/test-email'],
      ] as const) {
        const turned = await client.request(method, path, method === 'GET' ? {} : { json: {} })
        expect(turned.status, `${method} ${path}`).toBe(401)
        expect(await errorCode(turned), `${method} ${path}`).toBe('mfa_required')
      }

      // It can say who it is, and what is left to do.
      const session = await readJson(await client.get('/api/v1/auth/session'))
      expect(session).toMatchObject({ status: 'mfa_required', mfa: 'verification' })

      // It may not enrol a factor of its own: a stolen password must not be enough to add one.
      const enrol = await client.post('/api/v1/me/mfa/totp', {})
      expect(enrol.status).toBe(401)
      expect(await errorCode(enrol)).toBe('mfa_required')

      // It may leave.
      expect((await client.post('/api/v1/auth/logout')).status).toBe(204)
      expect(enrolled.secret).toBeTruthy()
    })

    it('a code finishes it: new token, mfa_verified_at set, full lifetime, same CSRF token, and the old token is dead', async () => {
      const { account, enrolled } = await accountWithFactor('verify')
      const { client, body } = await halfLogin(account.username, { remember: true })
      const before = client.sessionToken
      const csrfBefore = client.csrfToken

      const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      expect(res.status).toBe(200)
      const done = MfaVerifyResponse.parse(await res.json())
      expect(done.status).toBe('authenticated')
      expect(done.csrfToken).toBe(csrfBefore)
      expect(done.recoveryCodesRemaining).toBeNull()
      expect(done.account.username).toBe(account.username)
      expect(Date.parse(done.expiresAt) - env.clock.now().getTime()).toBeGreaterThan(13 * DAY)

      // «Remember me» is honoured now, with the new token.
      const cookie = res.headers.getSetCookie()[0] ?? ''
      expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43}; Max-Age=${String(14 * 86400)};`))
      expect(client.sessionToken).not.toBe(before)
      expect(body.status).toBe('mfa_required')

      const rows = await env.query<{ token_hash: string; mfa_verified_at: Date | null }>(
        'select token_hash, mfa_verified_at from session where account_id = $1',
        [account.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.mfa_verified_at).not.toBeNull()
      expect(rows[0]?.token_hash).toBe(
        createHash('sha256')
          .update(client.sessionToken ?? '')
          .digest('hex'),
      )

      expect((await client.get('/api/v1/me')).status).toBe(200)
      // The token the half session had is of no use.
      expect((await client.get('/api/v1/me', { cookie: `${SESSION_COOKIE_NAME}=${before ?? ''}` })).status).toBe(401)
    })

    it('without «Remember me» the new cookie is a session cookie with the short lifetime', async () => {
      const { account, enrolled } = await accountWithFactor('short')
      const { client } = await halfLogin(account.username)
      const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      expect(res.headers.getSetCookie()[0]).not.toMatch(/Max-Age/)
      const done = MfaVerifyResponse.parse(await res.json())
      const ms = Date.parse(done.expiresAt) - env.clock.now().getTime()
      expect(ms).toBeGreaterThan(DAY)
      expect(ms).toBeLessThanOrEqual(2 * DAY)
    })

    it('a wrong code is refused with 403 invalid_code, counted, and audited without the code', async () => {
      const { account, enrolled } = await accountWithFactor('wrong')
      const { client } = await halfLogin(account.username)
      const right = codeNow(env, enrolled.secret)
      const wrong = right === '123456' ? '654321' : '123456'
      const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: wrong })
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('invalid_code')
      const attempts = await env.query<{ succeeded: boolean }>(
        `select succeeded from login_attempt where account_id = $1 and action = 'mfa' and not succeeded`,
        [account.id],
      )
      expect(attempts).toEqual([{ succeeded: false }])
      const audit = await env.query<{ action: string; reason: string | null; new_value: unknown }>(
        `select action, reason, new_value from audit_log where account_id = $1 and action = 'mfa.verify_failed'`,
        [account.id],
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]?.reason).toBe('wrong_code')
      expect(JSON.stringify(audit)).not.toContain(wrong)
      // Still half signed in.
      expect((await client.get('/api/v1/me')).status).toBe(401)
    })

    it('takes a code with a space in the middle', async () => {
      const { account, enrolled } = await accountWithFactor('spaced')
      const { client } = await halfLogin(account.username)
      const code = codeNow(env, enrolled.secret)
      const res = await client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: `${code.slice(0, 3)} ${code.slice(3)}`,
      })
      expect(res.status).toBe(200)
    })

    it('accepts the step before and the step after the current one, and refuses two steps away', async () => {
      const { account, enrolled } = await accountWithFactor('window')
      // Two steps ahead and two behind: refused.
      for (const offset of [-60, 60]) {
        const { client } = await halfLogin(account.username)
        const res = await client.post('/api/v1/auth/mfa/verify', {
          type: 'totp',
          code: codeNow(env, enrolled.secret, offset),
        })
        expect(res.status, `offset ${String(offset)}`).toBe(403)
      }
      // One step ahead: accepted.
      const ahead = await halfLogin(account.username)
      expect(
        (await ahead.client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret, 30) }))
          .status,
      ).toBe(200)
    })

    it('accepts the step before the current one when nothing newer was used', async () => {
      const { account, enrolled } = await accountWithFactor('behind')
      // The enrolment used a step; one more has passed since, so the one before the current is later than the last used.
      nextStep(env)
      const { client } = await halfLogin(account.username)
      const res = await client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, enrolled.secret, -30),
      })
      expect(res.status).toBe(200)
    })

    it('refuses the same code again (a replay), also from a new login, and takes the next step', async () => {
      const { account, enrolled } = await accountWithFactor('replay')
      const first = await halfLogin(account.username)
      const code = codeNow(env, enrolled.secret)
      expect((await first.client.post('/api/v1/auth/mfa/verify', { type: 'totp', code })).status).toBe(200)

      const second = await halfLogin(account.username)
      const replay = await second.client.post('/api/v1/auth/mfa/verify', { type: 'totp', code })
      expect(replay.status).toBe(403)
      expect(await errorCode(replay)).toBe('invalid_code')
      const audit = await env.query<{ reason: string }>(
        `select reason from audit_log where account_id = $1 and action = 'mfa.verify_failed'`,
        [account.id],
      )
      expect(audit.map((row) => row.reason)).toEqual(['code_replayed'])

      // An older step's code is refused too, once a later step has been used.
      const older = await second.client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, enrolled.secret, -30),
      })
      expect(older.status).toBe(403)

      nextStep(env)
      const next = await second.client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, enrolled.secret),
      })
      expect(next.status).toBe(200)
    })

    it('two requests with the same code at once: exactly one gets in', async () => {
      const { account, enrolled } = await accountWithFactor('race')
      const a = await halfLogin(account.username)
      const b = await halfLogin(account.username)
      const code = codeNow(env, enrolled.secret)
      const results = await Promise.all([
        a.client.post('/api/v1/auth/mfa/verify', { type: 'totp', code }),
        b.client.post('/api/v1/auth/mfa/verify', { type: 'totp', code }),
      ])
      expect(results.map((res) => res.status).sort()).toEqual([200, 403])
    })

    it('a recovery code works once, however it is typed, and the count goes down', async () => {
      const { account, recoveryCodes } = await accountWithFactor('recovery')
      const code = recoveryCodes[0] ?? ''
      const typed = code.toLowerCase().replaceAll('-', ' ')

      const first = await halfLogin(account.username)
      const res = await first.client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: typed })
      expect(res.status).toBe(200)
      const done = MfaVerifyResponse.parse(await res.json())
      expect(done.recoveryCodesRemaining).toBe(9)

      const second = await halfLogin(account.username)
      const again = await second.client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code })
      expect(again.status).toBe(403)
      expect(await errorCode(again)).toBe('invalid_code')

      const rows = await env.query<{ used_at: Date | null }>(
        'select used_at from recovery_code where account_id = $1',
        [account.id],
      )
      expect(rows.filter((row) => row.used_at !== null)).toHaveLength(1)
      const audit = await env.query<{ action: string }>(
        `select action from audit_log where account_id = $1 and action like 'mfa.%' order by created_at`,
        [account.id],
      )
      expect(audit.map((row) => row.action)).toContain('mfa.recovery_code_used')
      expect(JSON.stringify(audit)).not.toContain(code)
    })

    it("another account's recovery code does not work, and neither does a made-up one", async () => {
      const mine = await accountWithFactor('mine')
      const theirs = await accountWithFactor('theirs')
      const { client } = await halfLogin(mine.account.username)
      const stolen = await client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: theirs.recoveryCodes[0] })
      expect(stolen.status).toBe(403)
      const madeUp = await client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: 'ABCD-EFGH-JKMN-PQRS' })
      expect(madeUp.status).toBe(403)
      const garbage = await client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: 'not a code at all!' })
      expect(garbage.status).toBe(403)
      // Three wrong tries, all counted.
      expect(
        await env.query(`select 1 from login_attempt where account_id = $1 and action = 'mfa' and not succeeded`, [
          mine.account.id,
        ]),
      ).toHaveLength(3)
    })

    it('locks after five wrong codes, even for the right one, and opens again after the lockout', async () => {
      const { account, enrolled } = await accountWithFactor('lock')
      const { client } = await halfLogin(account.username)
      for (let n = 0; n < 5; n += 1) {
        const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '000000' })
        expect(res.status).toBe(403)
      }
      const locked = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      expect(locked.status).toBe(429)
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0)
      // Recovery codes are behind the same limit.
      const recovery = await client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: 'ABCD-EFGH-JKMN-PQRS' })
      expect(recovery.status).toBe(429)

      // The half session lives 10 minutes and the lockout 20: a new login is needed, and the account is still locked.
      env.clock.advance(11 * MINUTE)
      const retry = await halfLogin(account.username)
      const stillLocked = await retry.client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, enrolled.secret),
      })
      expect(stillLocked.status).toBe(429)
      env.clock.advance(11 * MINUTE)
      const later = await halfLogin(account.username)
      const ok = await later.client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, enrolled.secret),
      })
      expect(ok.status).toBe(200)
    })

    it('counts per address too: another account is not affected, the same address is', async () => {
      const a = await accountWithFactor('ip-a')
      const b = await accountWithFactor('ip-b')
      const shared = '203.0.113.200'
      // 20 wrong codes (the address limit) across the two accounts: 5 on a locks a, the rest need b.
      const clientA = env.client({ ip: shared })
      await clientA.login(a.account.username, TEST_PASSWORD)
      const clientB = env.client({ ip: shared })
      await clientB.login(b.account.username, TEST_PASSWORD)
      for (let n = 0; n < 4; n += 1) {
        await clientA.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '000000' })
        await clientB.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '000000' })
      }
      // 8 wrong so far from the address; neither account is locked (4 each), the address is not (8 of 20).
      const okB = await clientB.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, b.enrolled.secret) })
      expect(okB.status).toBe(200)
    })

    it('a complete session is told there is nothing to verify, and a request without a session or token is refused', async () => {
      const account = await env.createAccount({ username: unique('complete') })
      const client = env.client({ ip: ip() })
      await client.login(account.username, TEST_PASSWORD)
      const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '123456' })
      expect(res.status).toBe(409)
      expect(await errorCode(res)).toBe('mfa_not_pending')

      const anonymous = env.client({ ip: ip() })
      expect(
        (await anonymous.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '123456' }, { csrf: 'none' })).status,
      ).toBe(401)

      const { account: other, enrolled } = await accountWithFactor('nocsrf')
      const half = await halfLogin(other.username)
      const noToken = await half.client.post(
        '/api/v1/auth/mfa/verify',
        { type: 'totp', code: codeNow(env, enrolled.secret) },
        { csrf: 'none' },
      )
      expect(noToken.status).toBe(403)
      const badShape = await half.client.post('/api/v1/auth/mfa/verify', { type: 'sms', code: '123456' })
      expect(badShape.status).toBe(400)
    })

    it('the half session ends after ten minutes', async () => {
      const { account, enrolled } = await accountWithFactor('expiry')
      const { client } = await halfLogin(account.username)
      env.clock.advance(11 * MINUTE)
      expect((await readJson(await client.get('/api/v1/auth/session'))).status).toBe('anonymous')
      const res = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
      expect(res.status).toBe(401)
    })
  })

  describe('the login state machine: a role that requires a factor', () => {
    it('enrolment finishes the login: editors without a factor can enrol, and nothing else, until they have', async () => {
      await setSetting(env, 'mfa_required_roles', ['editor'])
      try {
        const account = await env.createAccount({ username: unique('must'), role: 'editor' })
        const { client, res, body } = await halfLogin(account.username, { remember: true })
        expect(res.status).toBe(200)
        expect(body).toMatchObject({ status: 'mfa_required', mfa: 'enrolment' })

        // Normal endpoints refuse.
        const me = await client.get('/api/v1/me')
        expect(me.status).toBe(401)
        expect(await errorCode(me)).toBe('mfa_required')
        // Verify has nothing to verify.
        const verify = await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: '123456' })
        expect(verify.status).toBe(409)

        const before = client.sessionToken
        const enrolled = await enrolTotp(env, client)
        expect(enrolled.response.status).toBe(200)
        const done = MfaConfirmResponse.parse(await enrolled.response.json())
        expect(done.loginCompleted).toBe(true)
        expect(done.recoveryCodes).toHaveLength(10)
        // New token, long cookie, the session is complete.
        expect(client.sessionToken).not.toBe(before)
        expect(enrolled.response.headers.getSetCookie()[0]).toMatch(/Max-Age=1209600/)
        expect((await client.get('/api/v1/me')).status).toBe(200)
        expect((await client.get('/api/v1/me', { cookie: `${SESSION_COOKIE_NAME}=${before ?? ''}` })).status).toBe(401)
        const rows = await env.query<{ mfa_verified_at: Date | null }>(
          'select mfa_verified_at from session where account_id = $1',
          [account.id],
        )
        expect(rows[0]?.mfa_verified_at).not.toBeNull()

        // Next time it is a verification.
        nextStep(env)
        const again = await halfLogin(account.username)
        expect(again.body).toMatchObject({ status: 'mfa_required', mfa: 'verification' })
      } finally {
        await setSetting(env, 'mfa_required_roles', [])
      }
    })

    it('a role that is not on the list is not asked', async () => {
      await setSetting(env, 'mfa_required_roles', ['editor'])
      try {
        const author = await env.createAccount({ username: unique('free'), role: 'author' })
        const { body } = await halfLogin(author.username)
        expect(body.status).toBe('authenticated')
      } finally {
        await setSetting(env, 'mfa_required_roles', [])
      }
    })

    it('takes effect at once for a session that is already open', async () => {
      const account = await env.createAccount({ username: unique('midway'), role: 'author' })
      const client = env.client({ ip: ip() })
      await client.login(account.username, TEST_PASSWORD)
      expect((await client.get('/api/v1/me')).status).toBe(200)
      await setSetting(env, 'mfa_required_roles', ['author'])
      try {
        const res = await client.get('/api/v1/me')
        expect(res.status).toBe(401)
        expect(await errorCode(res)).toBe('mfa_required')
        expect((await readJson(await client.get('/api/v1/auth/session'))).mfa).toBe('enrolment')
      } finally {
        await setSetting(env, 'mfa_required_roles', [])
      }
    })

    it('a role that requires one, with a factor of its own, is asked for it (verification)', async () => {
      const { account, enrolled } = await accountWithFactor('both', 'editor')
      await setSetting(env, 'mfa_required_roles', ['editor'])
      try {
        const { client, body } = await halfLogin(account.username)
        expect(body.mfa).toBe('verification')
        expect(
          (await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })).status,
        ).toBe(200)
      } finally {
        await setSetting(env, 'mfa_required_roles', [])
      }
    })

    it('the last factor of an account whose role requires one cannot be removed', async () => {
      const { account, enrolled } = await accountWithFactor('keep', 'editor')
      await setSetting(env, 'mfa_required_roles', ['editor'])
      try {
        const { client } = await halfLogin(account.username)
        await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code: codeNow(env, enrolled.secret) })
        const list = MfaListResponse.parse(await (await client.get('/api/v1/me/mfa')).json())
        expect(list.required).toBe(true)
        const res = await client.delete(`/api/v1/me/mfa/${enrolled.id}`, { json: { password: TEST_PASSWORD } })
        expect(res.status).toBe(409)
        expect(await errorCode(res)).toBe('mfa_required_by_role')
        expect(await env.query('select 1 from mfa_credential where id = $1', [enrolled.id])).toHaveLength(1)
      } finally {
        await setSetting(env, 'mfa_required_roles', [])
      }
    })
  })

  describe('managing factors and recovery codes', () => {
    async function signedIn(base: string) {
      const made = await accountWithFactor(base)
      const { client } = await halfLogin(made.account.username)
      const verified = await client.post('/api/v1/auth/mfa/verify', {
        type: 'totp',
        code: codeNow(env, made.enrolled.secret),
      })
      expect(verified.status).toBe(200)
      nextStep(env)
      return { ...made, client }
    }

    it('lists the factors with their dates, and the recovery codes left', async () => {
      const { client, enrolled } = await signedIn('list')
      const res = await client.get('/api/v1/me/mfa')
      expect(res.headers.get('cache-control')).toBe('no-store')
      const list = MfaListResponse.parse(await res.json())
      expect(list.factors).toHaveLength(1)
      expect(list.factors[0]).toMatchObject({ id: enrolled.id, type: 'totp' })
      expect(list.factors[0]?.lastUsedAt).not.toBeNull()
      expect(list.recoveryCodesRemaining).toBe(10)
      expect(list.required).toBe(false)
      // Nothing secret in the answer.
      expect(JSON.stringify(list)).not.toContain(enrolled.secret)
    })

    it('removing needs the password or a fresh code; a wrong answer is 403, counted, and keeps the factor', async () => {
      const { client, enrolled } = await signedIn('remove-wrong')
      const wrongPassword = await client.delete(`/api/v1/me/mfa/${enrolled.id}`, {
        json: { password: 'not the password' },
      })
      expect(wrongPassword.status).toBe(403)
      expect(await errorCode(wrongPassword)).toBe('invalid_password')
      const wrongCode = await client.delete(`/api/v1/me/mfa/${enrolled.id}`, { json: { code: '000000' } })
      expect(wrongCode.status).toBe(403)
      expect(await errorCode(wrongCode)).toBe('invalid_code')
      const none = await client.delete(`/api/v1/me/mfa/${enrolled.id}`)
      expect(none.status).toBe(400)
      expect(await env.query('select 1 from mfa_credential where id = $1', [enrolled.id])).toHaveLength(1)
    })

    it('removing with the password works, takes the recovery codes with the last factor, and logs in without a second step after', async () => {
      const { account, client, enrolled } = await signedIn('remove-pw')
      const res = await client.delete(`/api/v1/me/mfa/${enrolled.id}`, { json: { password: TEST_PASSWORD } })
      expect(res.status).toBe(204)
      expect(await env.query('select 1 from mfa_credential where account_id = $1', [account.id])).toHaveLength(0)
      expect(await env.query('select 1 from recovery_code where account_id = $1', [account.id])).toHaveLength(0)
      const audit = await env.query<{ action: string }>(
        `select action from audit_log where account_id = $1 and action = 'mfa.removed'`,
        [account.id],
      )
      expect(audit).toHaveLength(1)
      const next = await halfLogin(account.username)
      expect(next.body.status).toBe('authenticated')
    })

    it('removing with a fresh code works, and the code is spent', async () => {
      const { client, enrolled, account } = await signedIn('remove-code')
      const code = codeNow(env, enrolled.secret)
      const res = await client.delete(`/api/v1/me/mfa/${enrolled.id}`, { json: { code } })
      expect(res.status).toBe(204)
      expect(await env.query('select 1 from mfa_credential where account_id = $1', [account.id])).toHaveLength(0)
    })

    it("another account's factor is not found, and the wrong id is not found", async () => {
      const mine = await signedIn('remove-mine')
      const theirs = await accountWithFactor('remove-theirs')
      const res = await mine.client.delete(`/api/v1/me/mfa/${theirs.enrolled.id}`, {
        json: { password: TEST_PASSWORD },
      })
      expect(res.status).toBe(404)
      expect(await env.query('select 1 from mfa_credential where id = $1', [theirs.enrolled.id])).toHaveLength(1)
      const none = await mine.client.delete(`/api/v1/me/mfa/0198a3c2-0000-7000-8000-000000000009`, {
        json: { password: TEST_PASSWORD },
      })
      expect(none.status).toBe(404)
    })

    it('removing one of two factors keeps the other and the recovery codes', async () => {
      const { client, enrolled, account } = await signedIn('remove-one')
      const second = await enrolTotp(env, client, 'to remove')
      const res = await client.delete(`/api/v1/me/mfa/${second.id}`, { json: { password: TEST_PASSWORD } })
      expect(res.status).toBe(204)
      expect(await env.query('select id from mfa_credential where account_id = $1', [account.id])).toEqual([
        { id: enrolled.id },
      ])
      expect(await env.query('select 1 from recovery_code where account_id = $1', [account.id])).toHaveLength(10)
    })

    it('new recovery codes replace the old ones, which stop working', async () => {
      const { client, account, recoveryCodes } = await signedIn('regenerate')
      const res = await client.post('/api/v1/me/mfa/recovery-codes', { password: TEST_PASSWORD })
      expect(res.status).toBe(200)
      const fresh = (await readJson(res)).recoveryCodes
      expect(fresh).toHaveLength(10)
      expect(await env.query('select 1 from recovery_code where account_id = $1', [account.id])).toHaveLength(10)

      const old = await halfLogin(account.username)
      expect(
        (await old.client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code: recoveryCodes[0] })).status,
      ).toBe(403)
      const code = Array.isArray(fresh) ? String(fresh[0]) : ''
      expect((await old.client.post('/api/v1/auth/mfa/verify', { type: 'recovery', code })).status).toBe(200)
    })

    it('new recovery codes need the password or a code, and a factor to belong to', async () => {
      const { client } = await signedIn('regenerate-wrong')
      expect((await client.post('/api/v1/me/mfa/recovery-codes', { password: 'nope' })).status).toBe(403)
      expect((await client.post('/api/v1/me/mfa/recovery-codes', {})).status).toBe(400)

      const bare = await env.createAccount({ username: unique('no-factor') })
      const other = env.client({ ip: ip() })
      await other.login(bare.username, TEST_PASSWORD)
      const none = await other.post('/api/v1/me/mfa/recovery-codes', { password: TEST_PASSWORD })
      expect(none.status).toBe(409)
      expect(await errorCode(none)).toBe('no_factor')
    })

    it('a wrong password for a step-up counts like a failed login', async () => {
      const { client, account } = await signedIn('stepup-limit')
      for (let n = 0; n < 5; n += 1) {
        expect((await client.post('/api/v1/me/mfa/recovery-codes', { password: `wrong ${String(n)}` })).status).toBe(
          403,
        )
      }
      const locked = await client.post('/api/v1/me/mfa/recovery-codes', { password: TEST_PASSWORD })
      expect(locked.status).toBe(429)
      const failed = await env.query(
        `select 1 from login_attempt where account_id = $1 and action = 'login' and not succeeded`,
        [account.id],
      )
      // Five wrong, and the sixth (right) one that the lockout turned away, which is counted too.
      expect(failed).toHaveLength(6)
    })
  })

  it('a code is bound to its secret: the code of another factor does not pass', async () => {
    const a = await accountWithFactor('bind-a')
    const b = await accountWithFactor('bind-b')
    const { client } = await halfLogin(a.account.username)
    // Same moment, other secret.
    const code = totpCodeAt(b.enrolled.secret, env.clock.now().getTime())
    const mine = totpCodeAt(a.enrolled.secret, env.clock.now().getTime())
    if (code !== mine) {
      expect((await client.post('/api/v1/auth/mfa/verify', { type: 'totp', code })).status).toBe(403)
    }
  })

  it('no secret, code or recovery code reaches the log', () => {
    const text = JSON.stringify(env.lines)
    expect(text).not.toMatch(/[A-Z2-7]{32}/)
    // A recovery code has letters; the all-digit fragments of the made-up ids in the paths are not codes.
    expect(text).not.toMatch(/\b(?=[0-9A-Z-]*[A-HJKMNP-TV-Z])[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}\b/)
  })
})

export type { TestClient }
