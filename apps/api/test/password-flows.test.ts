// Lost password and the first password (K-003, K-004, K-005 second half): the one-time link, what it may and may not do,
// and that the answer to «Lost your password?» does not depend on whether the account exists.
import { createHash } from 'node:crypto'

import { AcceptedResponse, ApiError } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { codeNow, enrolTotp, errorCode, mailsTo, nextStep, readJson, setSetting, tokenOf, unique } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('password-flows')

const HOUR = 60 * 60 * 1000
const NEW_PASSWORD = 'a brand new passphrase 42'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

interface TokenRow {
  id: string
  purpose: string
  token_hash: string
  new_email: string | null
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

/** An ApiError body without the id that differs from one request to the next, or any other JSON as it is. */
function withoutRequestId(body: unknown): unknown {
  const parsed = ApiError.safeParse(body)
  return parsed.success ? { code: parsed.data.error.code, message: parsed.data.error.message } : body
}

describe.skipIf(TEST_DATABASE_URL === undefined)('lost password and set password (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let ipCounter = 0
  const ip = () => `198.18.0.${String((ipCounter += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  const tokensOf = (accountId: string) =>
    env.query<TokenRow>('select * from account_token where account_id = $1 order by created_at, id', [accountId])

  async function lost(login: string, address = ip()) {
    return env.client({ ip: address }).post('/api/v1/auth/password/lost', { login })
  }

  async function reset(token: string, password = NEW_PASSWORD, address = ip()) {
    return env.client({ ip: address }).post('/api/v1/auth/password/reset', { token, password })
  }

  /** Asks for a link and returns its token, from the mail the recording port got. */
  async function linkFor(account: { username: string; email: string }): Promise<string> {
    expect((await lost(account.username)).status).toBe(202)
    return tokenOf(env, 'password_reset', account.email)
  }

  describe('asking for the link', () => {
    it('mails a link to an account that exists: stored as a hash, 24 hours, one purpose', async () => {
      const account = await env.createAccount({ username: unique('lost') })
      const before = env.clock.now().getTime()
      const res = await lost(account.username)
      expect(res.status).toBe(202)
      expect(AcceptedResponse.parse(await res.json())).toEqual({ status: 'accepted' })

      const mails = mailsTo(env, account.email)
      expect(mails).toHaveLength(1)
      expect(mails[0]?.template).toBe('password_reset')
      const token = tokenOf(env, 'password_reset', account.email)
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

      const rows = await tokensOf(account.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.purpose).toBe('password_reset')
      expect(rows[0]?.token_hash).toBe(sha256(token))
      expect(rows[0]?.token_hash).not.toBe(token)
      expect(rows[0]?.new_email).toBeNull()
      expect(rows[0]?.used_at).toBeNull()
      const lifetime = (rows[0]?.expires_at.getTime() ?? 0) - before
      expect(lifetime).toBeGreaterThan(24 * HOUR - 5000)
      expect(lifetime).toBeLessThan(24 * HOUR + 5000)
    })

    it('finds the account by e-mail address too, and without regard to case', async () => {
      const account = await env.createAccount({ username: unique('Mixed') })
      expect((await lost(account.email.toUpperCase())).status).toBe(202)
      expect(mailsTo(env, account.email)).toHaveLength(1)
      expect((await lost(account.username.toLowerCase())).status).toBe(202)
      expect(mailsTo(env, account.email)).toHaveLength(2)
    })

    it('answers exactly the same for an account that does not exist, and sends nothing', async () => {
      const real = await env.createAccount({ username: unique('exists') })
      const sentBefore = env.mail.sent.length
      const a = await lost(real.username)
      const sentAfterReal = env.mail.sent.length
      const b = await lost('nobody-by-this-name')
      const c = await lost('nobody@nowhere.example.test')
      expect(sentAfterReal).toBe(sentBefore + 1)
      expect(env.mail.sent.length).toBe(sentAfterReal)

      const shape = async (res: Response) => ({
        status: res.status,
        body: await res.clone().text(),
        contentType: res.headers.get('content-type'),
        cacheControl: res.headers.get('cache-control'),
        setCookie: res.headers.getSetCookie(),
        // Every header but the ones that are different for every request.
        headers: [...res.headers.keys()].filter((name) => !['x-request-id', 'date'].includes(name)).sort(),
      })
      expect(await shape(b)).toEqual(await shape(a))
      expect(await shape(c)).toEqual(await shape(a))
      expect(await shape(a)).toMatchObject({ status: 202, body: '{"status":"accepted"}' })
    })

    it('does not mail a disabled account', async () => {
      const account = await env.createAccount({ username: unique('off'), status: 'disabled' })
      const res = await lost(account.username)
      expect(res.status).toBe(202)
      expect(mailsTo(env, account.email)).toHaveLength(0)
      expect(await tokensOf(account.id)).toHaveLength(0)
    })

    it('gives an account that never chose a password its welcome link again, not a reset link', async () => {
      const account = await env.createAccount({ username: unique('waiting'), status: 'pending', passwordHash: null })
      expect((await lost(account.email)).status).toBe(202)
      const mails = mailsTo(env, account.email)
      expect(mails.map((mail) => mail.template)).toEqual(['set_password'])
      expect((await tokensOf(account.id))[0]?.purpose).toBe('set_password')
    })

    it('a new request voids the earlier link', async () => {
      const account = await env.createAccount({ username: unique('twice') })
      const first = await linkFor(account)
      const second = await linkFor(account)
      expect(second).not.toBe(first)
      const rows = await tokensOf(account.id)
      expect(rows).toHaveLength(2)
      expect(rows.filter((row) => row.used_at === null)).toHaveLength(1)
      expect((await reset(first)).status).toBe(400)
      expect((await reset(second)).status).toBe(204)
    })

    it('writes an audit entry for an account that exists, with no token in it', async () => {
      const account = await env.createAccount({ username: unique('audited') })
      const token = await linkFor(account)
      const rows = await env.query<{ action: string; actor: string; actor_type: string; new_value: unknown }>(
        `select action, actor, actor_type, new_value from audit_log where account_id = $1`,
        [account.id],
      )
      expect(rows.map((row) => row.action)).toEqual(['password.reset_requested'])
      expect(rows[0]).toMatchObject({ actor: 'anonymous', actor_type: 'system' })
      expect(JSON.stringify(rows)).not.toContain(token)
    })

    it('answers the same when the mail queue is down', async () => {
      const broken = env.variant({ mail: { sendMail: () => Promise.reject(new Error('the queue is down')) } })
      const account = await env.createAccount({ username: unique('queue-down') })
      const client = broken.client({ ip: ip() })
      const real = await client.post('/api/v1/auth/password/lost', { login: account.username })
      const none = await client.post('/api/v1/auth/password/lost', { login: 'nobody-here' })
      expect(real.status).toBe(202)
      expect(none.status).toBe(202)
      expect(await real.text()).toBe(await none.text())
      // The failure is in the log, without an address or a token.
      const logged = broken.lines.filter((line) => line['msg'] === 'could not queue a mail')
      expect(logged).toHaveLength(1)
      expect(JSON.stringify(logged)).not.toContain(account.email)
    })

    it('takes about the same time whether or not the account exists', async () => {
      const slow = env.variant({ minimumResponseMs: 300 })
      const account = await env.createAccount({ username: unique('timing-real') })
      const client = slow.client({ ip: ip() })
      const time = async (login: string) => {
        const started = performance.now()
        const res = await client.post('/api/v1/auth/password/lost', { login })
        expect(res.status).toBe(202)
        return performance.now() - started
      }
      const real: number[] = []
      const unknown: number[] = []
      for (let n = 0; n < 3; n += 1) {
        real.push(await time(account.username))
        unknown.push(await time(`nobody-${String(n)}`))
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0
      // Both are padded to the minimum; the difference is far under what a network could measure.
      expect(Math.min(...real, ...unknown)).toBeGreaterThanOrEqual(290)
      expect(Math.abs(median(real) - median(unknown))).toBeLessThan(150)
    })

    it('limits an address: the 21st request in a window is 429, whatever the name', async () => {
      const address = ip()
      for (let n = 0; n < 20; n += 1) {
        expect((await lost(`nobody-${String(n)}`, address)).status, `request ${String(n + 1)}`).toBe(202)
      }
      const res = await lost('nobody-else', address)
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      // Also for a name that exists: the answer does not depend on it.
      const real = await env.createAccount({ username: unique('real-limited') })
      expect((await lost(real.username, address)).status).toBe(429)
      expect(mailsTo(env, real.email)).toHaveLength(0)
    })

    it('makes the sixth request for one name wait, 429 with Retry-After, the same for a name nobody has; nothing more is mailed', async () => {
      const account = await env.createAccount({ username: unique('flooded') })
      const ghost = unique('flooded-ghost')
      const answers: string[] = []
      for (let n = 0; n < 7; n += 1) {
        // Different addresses, so only the limit of the name can act.
        const real = await lost(account.username, ip())
        const none = await lost(ghost, ip())
        expect(real.status).toBe(none.status)
        expect(real.headers.get('retry-after')).toBe(none.headers.get('retry-after'))
        const without = async (res: Response) => JSON.stringify(withoutRequestId(await res.json()))
        expect(await without(real)).toBe(await without(none))
        answers.push(`${String(real.status)} ${real.headers.get('retry-after') ?? '-'}`)
      }
      expect(answers).toEqual(['202 -', '202 -', '202 -', '202 -', '202 -', '429 30', '429 30'])
      expect(mailsTo(env, account.email)).toHaveLength(5)
      // Nothing is locked: after the wait the next request is answered.
      env.clock.advance(31_000)
      expect((await lost(account.username, ip())).status).toBe(202)
      expect(mailsTo(env, account.email)).toHaveLength(6)
    })

    it('requires a JSON body from our own origin', async () => {
      const client = env.client({ ip: ip() })
      expect(
        (await client.post('/api/v1/auth/password/lost', { login: 'x' }, { origin: 'https://evil.example' })).status,
      ).toBe(400)
      expect((await client.post('/api/v1/auth/password/lost', { login: 'x' }, { origin: null })).status).toBe(400)
      expect((await client.post('/api/v1/auth/password/lost', {})).status).toBe(400)
      expect((await client.post('/api/v1/auth/password/lost', { login: 'x', extra: 1 })).status).toBe(400)
      expect(
        (
          await client.request('POST', '/api/v1/auth/password/lost', {
            body: 'login=x',
            contentType: 'application/x-www-form-urlencoded',
          })
        ).status,
      ).toBe(400)
    })
  })

  describe('choosing the new password', () => {
    it('sets the password, uses the link up, signs out every session, and the new password logs in', async () => {
      const account = await env.createAccount({ username: unique('reset') })
      const phone = env.client({ ip: ip() })
      const laptop = env.client({ ip: ip() })
      await phone.login(account.username, TEST_PASSWORD)
      await laptop.login(account.username, TEST_PASSWORD)
      expect((await phone.get('/api/v1/me')).status).toBe(200)

      const token = await linkFor(account)
      const res = await reset(token)
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')

      // Every session is gone.
      expect((await phone.get('/api/v1/me')).status).toBe(401)
      expect((await laptop.get('/api/v1/me')).status).toBe(401)
      expect(await env.query('select 1 from session where account_id = $1', [account.id])).toHaveLength(0)

      // The new password works, the old one does not, and the hash is argon2id.
      expect((await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)).status).toBe(401)
      expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(200)
      const [row] = await env.query<{ password_hash: string }>('select password_hash from account where id = $1', [
        account.id,
      ])
      expect(row?.password_hash).toMatch(/^\$argon2id\$/)

      const rows = await tokensOf(account.id)
      expect(rows[0]?.used_at).not.toBeNull()
      const audit = await env.query<{ action: string }>(
        `select action from audit_log where account_id = $1 order by created_at`,
        [account.id],
      )
      expect(audit.map((entry) => entry.action)).toContain('password.reset')
    })

    it('works once: the second use of the same link is refused', async () => {
      const account = await env.createAccount({ username: unique('once') })
      const token = await linkFor(account)
      expect((await reset(token)).status).toBe(204)
      const again = await reset(token, 'yet another passphrase 7')
      expect(again.status).toBe(400)
      expect(await errorCode(again)).toBe('invalid_token')
      // And the password is still the first one chosen.
      expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(200)
    })

    it('two requests with the same link at once: exactly one wins', async () => {
      const account = await env.createAccount({ username: unique('raced') })
      const token = await linkFor(account)
      const results = await Promise.all([
        reset(token, 'first passphrase one 1'),
        reset(token, 'second passphrase two 2'),
      ])
      expect(results.map((res) => res.status).sort()).toEqual([204, 400])
    })

    it('stops working after 24 hours, and works just before', async () => {
      const early = await env.createAccount({ username: unique('early') })
      const late = await env.createAccount({ username: unique('late') })
      const earlyToken = await linkFor(early)
      const lateToken = await linkFor(late)
      env.clock.advance(24 * HOUR - 60_000)
      expect((await reset(earlyToken)).status).toBe(204)
      env.clock.advance(2 * 60_000)
      const expired = await reset(lateToken)
      expect(expired.status).toBe(400)
      expect(await errorCode(expired)).toBe('invalid_token')
      expect((await tokensOf(late.id))[0]?.used_at).toBeNull()
    })

    it('refuses a link that does not exist, one that has expired and one that was used with the same answer', async () => {
      const answer = async (res: Response) => {
        expect(res.status).toBe(400)
        const body = ApiError.parse(await res.json())
        return { code: body.error.code, message: body.error.message }
      }
      const unknown = await answer(await reset('x'.repeat(43)))
      expect(unknown.code).toBe('invalid_token')

      const stale = await env.createAccount({ username: unique('stale') })
      const staleToken = await linkFor(stale)
      const used = await env.createAccount({ username: unique('spent') })
      const usedToken = await linkFor(used)
      expect((await reset(usedToken)).status).toBe(204)
      env.clock.advance(25 * HOUR)
      expect(await answer(await reset(staleToken))).toEqual(unknown)
      expect(await answer(await reset(usedToken))).toEqual(unknown)
    })

    it('refuses something that cannot be a token, as a plain validation error', async () => {
      for (const token of [
        '',
        'short',
        'a'.repeat(200),
        'has space in it but is long enough to pass a length check!!',
        '../../etc/passwd',
      ]) {
        const res = await reset(token)
        expect(res.status, token).toBe(400)
        expect(await errorCode(res), token).toBe('validation_error')
      }
    })

    it('a link only works for its own purpose: a set-password link is no reset link, and the reverse', async () => {
      const account = await env.createAccount({ username: unique('purpose') })
      const resetToken = await linkFor(account)
      const pending = await env.createAccount({
        username: unique('purpose-pending'),
        status: 'pending',
        passwordHash: null,
      })
      expect((await lost(pending.email)).status).toBe(202)
      const setToken = tokenOf(env, 'set_password', pending.email)

      const client = env.client({ ip: ip() })
      // A reset link on the set route, a set link on the reset route.
      const wrongSet = await client.post('/api/v1/auth/password/set', { token: resetToken, password: NEW_PASSWORD })
      expect(wrongSet.status).toBe(400)
      expect(await errorCode(wrongSet)).toBe('invalid_token')
      const wrongReset = await client.post('/api/v1/auth/password/reset', { token: setToken, password: NEW_PASSWORD })
      expect(wrongReset.status).toBe(400)

      // Neither link was used up by the wrong call.
      expect((await tokensOf(account.id))[0]?.used_at).toBeNull()
      expect((await tokensOf(pending.id))[0]?.used_at).toBeNull()

      // An e-mail change link is neither.
      const owner = await env.createAccount({ username: unique('purpose-mail') })
      const session = env.client({ ip: ip() })
      await session.login(owner.username, TEST_PASSWORD)
      const change = await session.post('/api/v1/me/email-change', {
        newEmail: `${unique('moved')}@example.test`,
        password: TEST_PASSWORD,
      })
      expect(change.status).toBe(202)
      const emailToken = (
        await env.query<{ token_hash: string }>('select token_hash from account_token where account_id = $1', [
          owner.id,
        ])
      )[0]
      expect(emailToken).toBeDefined()
      const mail = env.mail.sent.filter((m) => m.template === 'email_change').at(-1)
      const changeToken = mail !== undefined && 'token' in mail.data ? mail.data.token : ''
      expect((await reset(changeToken)).status).toBe(400)
      expect(
        (await client.post('/api/v1/auth/password/set', { token: changeToken, password: NEW_PASSWORD })).status,
      ).toBe(400)
      // And a reset link on the e-mail change route (signed in as the owner of the account).
      const ownerReset = await linkFor(owner)
      const cross = await session.post('/api/v1/me/email-change/confirm', { token: ownerReset })
      expect(cross.status).toBe(400)
      expect((await tokensOf(owner.id)).find((row) => row.purpose === 'password_reset')?.used_at).toBeNull()
    })

    it('refuses a password that is too short, or the username or the address, and keeps the link usable', async () => {
      const account = await env.createAccount({
        username: unique('choosyuser'),
        email: `${unique('choosy')}@example.test`,
      })
      const token = await linkFor(account)
      const short = await reset(token, 'short')
      expect(short.status).toBe(400)
      expect(await errorCode(short)).toBe('validation_error')
      for (const same of [
        account.username,
        account.username.toUpperCase(),
        account.email,
        account.email.toUpperCase(),
      ]) {
        const res = await reset(token, same)
        expect(res.status, same).toBe(400)
        expect(await errorCode(res), same).toBe('weak_password')
      }
      expect((await tokensOf(account.id))[0]?.used_at).toBeNull()
      expect((await reset(token)).status).toBe(204)
    })

    it('refuses a link for an account that has been disabled since', async () => {
      const account = await env.createAccount({ username: unique('banned') })
      const token = await linkFor(account)
      await env.query(`update account set status = 'disabled' where id = $1`, [account.id])
      expect((await reset(token)).status).toBe(400)
      expect(
        (await env.query<{ password_hash: string }>('select password_hash from account where id = $1', [account.id]))[0]
          ?.password_hash,
      ).toMatch(/^\$argon2id\$/)
    })

    it("voids the account's other links: a pending e-mail change dies with the old password", async () => {
      const account = await env.createAccount({ username: unique('voided') })
      const session = env.client({ ip: ip() })
      await session.login(account.username, TEST_PASSWORD)
      await session.post('/api/v1/me/email-change', {
        newEmail: `${unique('late')}@example.test`,
        password: TEST_PASSWORD,
      })
      const token = await linkFor(account)
      expect((await reset(token)).status).toBe(204)
      const rows = await tokensOf(account.id)
      expect(rows.every((row) => row.used_at !== null)).toBe(true)
    })

    it('does not skip the second factor: the next login still asks for the code', async () => {
      const account = await env.createAccount({ username: unique('with-factor') })
      const first = env.client({ ip: ip() })
      await first.login(account.username, TEST_PASSWORD)
      const enrolled = await enrolTotp(env, first)
      expect(enrolled.response.status).toBe(200)
      const token = await linkFor(account)
      expect((await reset(token)).status).toBe(204)
      nextStep(env)
      const res = await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)
      expect(await readJson(res)).toMatchObject({ status: 'mfa_required', mfa: 'verification' })
      expect(codeNow(env, enrolled.secret)).toMatch(/^\d{6}$/)
    })

    it('mails the administrators when the setting is on, and nobody when it is off', async () => {
      const admin = await env.createAccount({ username: unique('boss'), role: 'administrator' })
      const subject = await env.createAccount({ username: unique('changer') })
      await setSetting(env, 'notify_admin_password_change', true)
      expect((await reset(await linkFor(subject))).status).toBe(204)
      const notices = mailsTo(env, admin.email).filter((mail) => mail.template === 'admin_password_change')
      expect(notices).toHaveLength(1)
      expect(notices[0]?.data).toEqual({ username: subject.username })

      const quiet = await env.createAccount({ username: unique('quiet') })
      await setSetting(env, 'notify_admin_password_change', false)
      try {
        const before = mailsTo(env, admin.email).length
        expect((await reset(await linkFor(quiet))).status).toBe(204)
        expect(mailsTo(env, admin.email)).toHaveLength(before)
      } finally {
        await setSetting(env, 'notify_admin_password_change', true)
      }
    })

    it('does not mail an administrator about their own reset', async () => {
      const admin = await env.createAccount({ username: unique('self-boss'), role: 'administrator' })
      expect((await reset(await linkFor(admin))).status).toBe(204)
      expect(mailsTo(env, admin.email).map((mail) => mail.template)).toEqual(['password_reset', 'security_notice'])
    })

    it('tells the owner after a reset with a link, and not after the first password of a new account', async () => {
      const account = await env.createAccount({ username: unique('told') })
      expect((await reset(await linkFor(account))).status).toBe(204)
      expect(
        mailsTo(env, account.email)
          .filter((mail) => mail.template === 'security_notice')
          .map((mail) => mail.data),
      ).toEqual([{ username: account.username, action: 'password_reset' }])

      const pending = await env.createAccount({ username: unique('welcome'), status: 'pending', passwordHash: null })
      expect((await lost(pending.username)).status).toBe(202)
      const token = tokenOf(env, 'set_password', pending.email)
      expect(
        (await env.client({ ip: ip() }).post('/api/v1/auth/password/set', { token, password: NEW_PASSWORD })).status,
      ).toBe(204)
      expect(mailsTo(env, pending.email).filter((mail) => mail.template === 'security_notice')).toHaveLength(0)
    })

    it('ends the wait after failed logins: a finished reset clears the counter of the account', async () => {
      const account = await env.createAccount({ username: unique('cleared') })
      const attacker = env.client({ ip: ip() })
      for (let n = 0; n < 5; n += 1) {
        expect((await attacker.login(account.username, `guess ${String(n)}`)).status).toBe(401)
      }
      expect((await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)).status).toBe(429)

      expect((await reset(await linkFor(account))).status).toBe(204)
      // At once, with no waiting: the owner is back in.
      const owner = env.client({ ip: ip() })
      expect((await owner.login(account.username, NEW_PASSWORD)).status).toBe(200)
      // And the five free tries start over.
      for (let n = 0; n < 5; n += 1) {
        expect((await attacker.login(account.username, `again ${String(n)}`)).status).toBe(401)
      }
      expect((await attacker.login(account.username, 'one more')).status).toBe(429)
    })

    it('counts every try against the address: the 21st is 429', async () => {
      const address = ip()
      for (let n = 0; n < 20; n += 1) {
        expect((await reset('z'.repeat(43), NEW_PASSWORD, address)).status).toBe(400)
      }
      const res = await reset('z'.repeat(43), NEW_PASSWORD, address)
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).not.toBeNull()
    })

    it('puts no token and no password in the log or the audit log', async () => {
      const account = await env.createAccount({ username: unique('quietly') })
      const token = await linkFor(account)
      await reset(token, 'passphrase that must stay secret 99')
      const everything = JSON.stringify([
        env.lines,
        await env.query('select * from audit_log where account_id = $1', [account.id]),
      ])
      expect(everything).not.toContain(token)
      expect(everything).not.toContain('passphrase that must stay secret 99')
    })
  })

  describe('the first password (set)', () => {
    it('a pending account chooses its first password with the welcome link and is then active', async () => {
      const account = await env.createAccount({ username: unique('welcome'), status: 'pending', passwordHash: null })
      // It cannot sign in yet.
      expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(401)
      expect((await lost(account.username)).status).toBe(202)
      const token = tokenOf(env, 'set_password', account.email)
      const res = await env.client({ ip: ip() }).post('/api/v1/auth/password/set', { token, password: NEW_PASSWORD })
      expect(res.status).toBe(204)
      const [row] = await env.query<{ status: string; password_hash: string }>(
        'select status, password_hash from account where id = $1',
        [account.id],
      )
      expect(row?.status).toBe('active')
      expect(row?.password_hash).toMatch(/^\$argon2id\$/)
      expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(200)
      // Used up.
      const again = await env.client({ ip: ip() }).post('/api/v1/auth/password/set', { token, password: NEW_PASSWORD })
      expect(again.status).toBe(400)
      // A first password is not a «password changed» event: no notice to the administrators.
      const admin = await env.createAccount({ username: unique('watcher'), role: 'administrator' })
      expect(mailsTo(env, admin.email)).toHaveLength(0)
    })
  })
})
