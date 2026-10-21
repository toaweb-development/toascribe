// K-026, K-313, K-004: login limits per IP and per account, with growing lockouts, and one answer whether the account exists.
import { verifyPassword } from '@toascribe/auth'
import type * as AuthModule from '@toascribe/auth'
import { ApiError } from '@toascribe/shared'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

vi.mock('@toascribe/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

noticeIfSkipped('rate-limit')

const MINUTE = 60 * 1000
const T0 = new Date('2027-01-10T12:00:00Z')

interface Answer {
  readonly status: number
  readonly body: unknown
  readonly retryAfter: string | null
  readonly setCookie: string[]
}

/** What a caller sees of a response, with the per-request id removed. */
async function answerOf(res: Response): Promise<Answer> {
  const body: unknown = await res.json()
  const parsed = ApiError.safeParse(body)
  const cleaned = parsed.success
    ? { error: { code: parsed.data.error.code, message: parsed.data.error.message } }
    : body
  return {
    status: res.status,
    body: cleaned,
    retryAfter: res.headers.get('retry-after'),
    setCookie: res.headers.getSetCookie(),
  }
}

describe.skipIf(TEST_DATABASE_URL === undefined)('rate limiting (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let counter = 0
  const uniqueName = (base: string) => `${base}${String((counter += 1))}`
  /** Each test gets addresses of its own, so a lockout in one never reaches another. */
  let nextOctet = 10
  const freshIp = () => `192.0.2.${String((nextOctet += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })
  afterEach(async () => {
    env.clock.set(new Date(Date.now()))
    await env.query(`update setting set value = '5'::jsonb where key = 'login_limit_account_attempts'`)
    await env.query(`update setting set value = '20'::jsonb where key = 'login_limit_ip_attempts'`)
    await env.query(`update setting set value = '15'::jsonb where key = 'login_limit_window_minutes'`)
    await env.query(`update setting set value = '20'::jsonb where key = 'login_limit_lockout_minutes'`)
    await env.query(`update setting set value = '1440'::jsonb where key = 'login_limit_lockout_max_minutes'`)
  })

  async function failNTimes(client: TestClient, login: string, times: number): Promise<Response[]> {
    const out: Response[] = []
    for (let i = 0; i < times; i += 1) {
      out.push(await client.login(login, `wrong-${String(i)}`))
    }
    return out
  }

  describe('per account', () => {
    it('locks the account after 5 failures: even the right password is refused, in the words of a wrong one', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('victim') })
      const client = env.client({ ip: freshIp() })
      const failures = await failNTimes(client, account.username, 5)
      expect(failures.map((r) => r.status)).toEqual([401, 401, 401, 401, 401])

      const locked = await client.login(account.username, TEST_PASSWORD)
      expect(locked.status).toBe(401)
      expect(locked.headers.getSetCookie()).toEqual([])
      expect(ApiError.parse(await locked.json()).error.code).toBe('invalid_credentials')
      expect(client.cookie).toBeUndefined()

      // Still locked just before the 20 minutes are over, free just after.
      env.clock.set(new Date(T0.getTime() + 19 * MINUTE))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(401)
      env.clock.set(new Date(T0.getTime() + 21 * MINUTE))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('doubles the lockout each time: 20, 40, then 80 minutes', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('repeat') })
      const client = env.client({ ip: freshIp() })
      const tryRight = async () => (await client.login(account.username, TEST_PASSWORD)).status
      const clientAt = (minutes: number) => {
        env.clock.set(new Date(T0.getTime() + minutes * MINUTE))
      }

      await failNTimes(client, account.username, 5) // locked until +20
      clientAt(21)
      await failNTimes(client, account.username, 5) // locked until +21+40 = +61
      clientAt(21 + 39)
      expect(await tryRight()).toBe(401)
      clientAt(21 + 41)
      await failNTimes(client, account.username, 5) // locked until +62+80 = +142
      clientAt(62 + 79)
      expect(await tryRight()).toBe(401)
      clientAt(62 + 81)
      expect(await tryRight()).toBe(200)
    })

    it('ends the streak with a success: 4 failures, a success, 4 failures is not a lockout', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('streak') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 4)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      await failNTimes(client, account.username, 4)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('counts failures only inside the window: one every 4 minutes never locks', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('slow') })
      const client = env.client({ ip: freshIp() })
      for (let i = 0; i < 12; i += 1) {
        env.clock.set(new Date(T0.getTime() + i * 4 * MINUTE))
        expect((await client.login(account.username, 'wrong')).status).toBe(401)
      }
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('locks per account across addresses: five addresses, one failure each', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('spread') })
      for (let i = 0; i < 5; i += 1) {
        await env.client({ ip: freshIp() }).login(account.username, 'wrong')
      }
      expect((await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)).status).toBe(401)
      // Another account from the same addresses is not affected.
      const other = await env.createAccount({ username: uniqueName('other') })
      expect((await env.client({ ip: freshIp() }).login(other.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('follows the settings: 2 attempts, 1 minute, a cap of 60', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '2'::jsonb where key = 'login_limit_account_attempts'`)
      await env.query(`update setting set value = '1'::jsonb where key = 'login_limit_lockout_minutes'`)
      await env.query(`update setting set value = '60'::jsonb where key = 'login_limit_lockout_max_minutes'`)
      const account = await env.createAccount({ username: uniqueName('strict') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 2)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(401)
      env.clock.set(new Date(T0.getTime() + 2 * MINUTE))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('a setting stored invalid does not loosen the limit: the default applies', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '100000'::jsonb where key = 'login_limit_account_attempts'`)
      const account = await env.createAccount({ username: uniqueName('badlimit') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 5)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(401)
    })
  })

  describe('per IP address', () => {
    it('locks the address after 20 failures with a 429 and Retry-After, for every account, even a right password', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('bystander') })
      const ip = freshIp()
      const attacker = env.client({ ip })
      // 20 different names, so no account gets 5 failures.
      for (let i = 0; i < 20; i += 1) {
        expect((await attacker.login(`nobody-${String(i)}`, 'guess')).status).toBe(401)
      }
      const res = await attacker.login(account.username, TEST_PASSWORD)
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).toBe(String(20 * 60))
      expect(ApiError.parse(await res.json()).error.code).toBe('too_many_requests')
      expect(attacker.cookie).toBeUndefined()

      // Another address is not touched.
      expect((await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)).status).toBe(200)

      env.clock.set(new Date(T0.getTime() + 21 * MINUTE))
      expect((await attacker.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('answers a locked address the same for an existing and an unknown account', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('exists') })
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.login(`nobody-${String(i)}`, 'guess')
      }
      const existing = await answerOf(await attacker.login(account.username, 'wrong'))
      const unknown = await answerOf(await attacker.login('no-such-account', 'wrong'))
      expect(existing.status).toBe(429)
      expect(existing).toEqual(unknown)
    })

    it('does not write attempts it refused, so a locked address does not lock itself for ever', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.login(`nobody-${String(i)}`, 'guess')
      }
      const count = async () =>
        (await env.query<{ n: string }>(`select count(*) as n from login_attempt where ip = $1`, [ip]))[0]?.n
      expect(await count()).toBe('20')
      for (let i = 0; i < 10; i += 1) {
        expect((await attacker.login('nobody', 'guess')).status).toBe(429)
      }
      expect(await count()).toBe('20')
      // Free after one lockout, not after 30 minutes of hammering.
      env.clock.set(new Date(T0.getTime() + 21 * MINUTE))
      expect((await attacker.login('nobody', 'guess')).status).toBe(401)
    })

    it('doubles for the address too', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '3'::jsonb where key = 'login_limit_ip_attempts'`)
      const attacker = env.client({ ip: freshIp() })
      for (let i = 0; i < 3; i += 1) {
        await attacker.login(`nobody-${String(i)}`, 'guess')
      }
      expect((await attacker.login('x', 'y')).headers.get('retry-after')).toBe(String(20 * 60))
      env.clock.set(new Date(T0.getTime() + 21 * MINUTE))
      for (let i = 0; i < 3; i += 1) {
        await attacker.login(`nobody-${String(i)}`, 'guess')
      }
      expect((await attacker.login('x', 'y')).headers.get('retry-after')).toBe(String(40 * 60))
    })

    it('is not dodged with X-Forwarded-For: only X-Real-IP names the client', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.request('POST', '/api/v1/auth/login', {
          json: { login: `nobody-${String(i)}`, password: 'guess' },
          csrf: 'none',
          headers: { 'x-forwarded-for': `10.9.8.${String(i)}` },
        })
      }
      const res = await attacker.request('POST', '/api/v1/auth/login', {
        json: { login: 'nobody', password: 'guess' },
        csrf: 'none',
        headers: { 'x-forwarded-for': '10.1.1.1' },
      })
      expect(res.status).toBe(429)
    })

    it('counts an IPv6 client by its /64: changing the rest of the address does not give a new allowance', async () => {
      env.clock.set(T0)
      for (let i = 0; i < 20; i += 1) {
        const rotating = env.client({ ip: `2001:db8:77:5:${String(i + 1)}::${String(i + 1)}` })
        expect((await rotating.login(`nobody-${String(i)}`, 'guess')).status).toBe(401)
      }
      expect((await env.client({ ip: '2001:db8:77:5:ffff::1' }).login('nobody', 'guess')).status).toBe(429)
      // The next /64 is another subscriber.
      expect((await env.client({ ip: '2001:db8:77:6::1' }).login('nobody', 'guess')).status).toBe(401)
      const rows = await env.query<{ ip: string }>(
        `select distinct host(ip) as ip from login_attempt where ip << '2001:db8:77:5::/64'`,
      )
      expect(rows).toEqual([{ ip: '2001:db8:77:5::' }])
    })

    it('does not count successful logins: 25 people behind one address can all sign in', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      for (let i = 0; i < 25; i += 1) {
        const account = await env.createAccount({ username: uniqueName('nat') })
        expect((await env.client({ ip }).login(account.username, TEST_PASSWORD)).status).toBe(200)
      }
    })

    it('puts requests without a readable address in one shared bucket', async () => {
      env.clock.set(T0)
      // No X-Real-IP and no socket: every such request is "0.0.0.0", and is limited like any other address.
      const anonymous = env.client({ ip: 'not-an-address' })
      for (let i = 0; i < 20; i += 1) {
        await anonymous.login(`nobody-${String(i)}`, 'guess')
      }
      expect((await anonymous.login('nobody', 'guess')).status).toBe(429)
      const rows = await env.query<{ ip: string }>(
        `select distinct host(ip) as ip from login_attempt where ip = '0.0.0.0'`,
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('guesses sent at the same moment', () => {
    it('cannot all pass a limit of five: only five are judged as an open account, the rest meet the lockout', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('burst') })
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          env.client({ ip: freshIp() }).login(account.username, `guess-${String(i)}`),
        ),
      )
      expect(results.every((res) => res.status === 401)).toBe(true)
      const reasons = await env.query<{ reason: string; n: string }>(
        `select reason, count(*) as n from audit_log where account_id = $1 and action = 'login.failed' group by reason order by reason`,
        [account.id],
      )
      expect(reasons).toEqual([
        { reason: 'account_locked', n: '15' },
        { reason: 'wrong_password', n: '5' },
      ])
      // And the right password is refused afterwards, as for any locked account.
      expect((await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)).status).toBe(401)
    })

    it('cannot all pass a limit of twenty for one address: the rest get a 429', async () => {
      env.clock.set(T0)
      const attacker = env.client({ ip: freshIp() })
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => attacker.login(`nobody-${String(i)}`, 'guess')),
      )
      expect(results.filter((res) => res.status === 401)).toHaveLength(20)
      expect(results.filter((res) => res.status === 429)).toHaveLength(10)
    })

    it('a right password sent among wrong ones, after the limit is used up, is refused', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('race') })
      await failNTimes(env.client({ ip: freshIp() }), account.username, 5)
      const results = await Promise.all([
        ...Array.from({ length: 5 }, (_, i) =>
          env.client({ ip: freshIp() }).login(account.username, `guess-${String(i)}`),
        ),
        env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD),
      ])
      expect(results.map((res) => res.status)).toEqual([401, 401, 401, 401, 401, 401])
    })
  })

  describe('one answer whether the account exists (K-004)', () => {
    it('gives identical status, body and headers for an account and a name nobody has, at every step', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('twin') })
      const real = env.client({ ip: freshIp() })
      const ghost = env.client({ ip: freshIp() })
      const sameAnswers: boolean[] = []
      // Seven attempts: five that lock the account, then two while it is locked.
      for (let i = 0; i < 7; i += 1) {
        const a = await answerOf(await real.login(account.username, `wrong-${String(i)}`))
        const b = await answerOf(await ghost.login(`ghost-of-${account.username}`, `wrong-${String(i)}`))
        sameAnswers.push(JSON.stringify(a) === JSON.stringify(b))
        expect(a.status).toBe(401)
      }
      expect(sameAnswers).toEqual([true, true, true, true, true, true, true])
      // And the right password for the locked account, against a ghost with a "right" password.
      expect(await answerOf(await real.login(account.username, TEST_PASSWORD))).toEqual(
        await answerOf(await ghost.login(`ghost-of-${account.username}`, TEST_PASSWORD)),
      )
    })

    it('does the same work for an account that does not exist: one password check, against the dummy hash', async () => {
      const mock = vi.mocked(verifyPassword)
      const account = await env.createAccount({ username: uniqueName('work') })
      const nopass = await env.createAccount({ username: uniqueName('nopass'), passwordHash: null })

      mock.mockClear()
      await env.client({ ip: freshIp() }).login(account.username, 'wrong')
      await env.client({ ip: freshIp() }).login('there-is-nobody-called-this', 'wrong')
      await env.client({ ip: freshIp() }).login(nopass.username, 'wrong')
      expect(mock).toHaveBeenCalledTimes(3)
      for (const call of mock.mock.calls) {
        expect(call[1]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
      }
      // The dummy is not the real account's hash.
      expect(mock.mock.calls[1]?.[1]).not.toBe(mock.mock.calls[0]?.[1])
      expect(mock.mock.calls[2]?.[1]).toBe(mock.mock.calls[1]?.[1])
    })

    it('also for an account that is locked, and for a disabled one with the right password', async () => {
      const mock = vi.mocked(verifyPassword)
      env.clock.set(T0)
      const locked = await env.createAccount({ username: uniqueName('lockedwork') })
      const disabled = await env.createAccount({ username: uniqueName('disabledwork'), status: 'disabled' })
      await failNTimes(env.client({ ip: freshIp() }), locked.username, 5)
      mock.mockClear()
      await env.client({ ip: freshIp() }).login(locked.username, TEST_PASSWORD)
      await env.client({ ip: freshIp() }).login(disabled.username, TEST_PASSWORD)
      expect(mock).toHaveBeenCalledTimes(2)
    })

    it('records the attempts without the typed name: the table has an account id or nothing', async () => {
      const account = await env.createAccount({ username: uniqueName('recorded') })
      const ip = freshIp()
      await env.client({ ip }).login(account.username, 'wrong')
      await env.client({ ip }).login('typed-a-password-here', 'wrong')
      await env.client({ ip }).login(account.username, TEST_PASSWORD)
      const rows = await env.query<{ account_id: string | null; succeeded: boolean; action: string }>(
        `select account_id, succeeded, action from login_attempt where ip = $1 order by created_at, id`,
        [ip],
      )
      expect(rows).toEqual([
        { account_id: account.id, succeeded: false, action: 'login' },
        { account_id: null, succeeded: false, action: 'login' },
        { account_id: account.id, succeeded: true, action: 'login' },
      ])
      const columns = await env.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'login_attempt'`,
      )
      expect(columns.map((c) => c.column_name).sort()).toEqual([
        'account_id',
        'action',
        'created_at',
        'id',
        'ip',
        'succeeded',
      ])
    })
  })

  describe('the limiter other flows call (register, lost password)', () => {
    it('counts every request, not only failures, and keeps the actions apart', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      const limiter = env.services.limiter
      for (let i = 0; i < 19; i += 1) {
        await limiter.begin('register', { ip })
      }
      expect((await limiter.check('register', { ip })).ip.locked).toBe(false)
      await limiter.begin('register', { ip })
      const status = await limiter.check('register', { ip })
      expect(status.ip.locked).toBe(true)
      expect(status.ip.until).toEqual(new Date(T0.getTime() + 20 * MINUTE))
      // Registering many times does not lock login, nor lost password.
      expect((await limiter.check('login', { ip })).ip.locked).toBe(false)
      expect((await limiter.check('password_lost', { ip })).ip.locked).toBe(false)
      // And the lockout ends.
      env.clock.set(new Date(T0.getTime() + 21 * MINUTE))
      expect((await limiter.check('register', { ip })).ip.locked).toBe(false)
    })

    it('limits lost-password requests for one account from many addresses, and tells the account apart from the address', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('mailbomb') })
      const limiter = env.services.limiter
      for (let i = 0; i < 5; i += 1) {
        await limiter.begin('password_lost', { ip: freshIp(), accountId: account.id })
      }
      const status = await limiter.check('password_lost', { ip: freshIp(), accountId: account.id })
      expect(status.account.locked).toBe(true)
      expect(status.ip.locked).toBe(false)
      expect((await limiter.check('password_lost', { ip: freshIp() })).account.locked).toBe(false)
    })
  })
})
