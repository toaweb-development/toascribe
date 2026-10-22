// K-026, K-313, K-004: login limits per IP address and per login name. No hard lock: after a few failures the next try waits,
// the wait doubles and ends by itself. One answer whether the account exists. (The arithmetic is in delay.test.ts.)
import { verifyPassword } from '@toascribe/auth'
import type * as AuthModule from '@toascribe/auth'
import { ApiError } from '@toascribe/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

vi.mock('@toascribe/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

noticeIfSkipped('rate-limit')

const SECOND = 1000
const MINUTE = 60 * SECOND
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
  /** Each test gets addresses of its own, so a wait in one never reaches another. */
  let nextOctet = 10
  const freshIp = () => `192.0.2.${String((nextOctet += 1))}`

  /** Names that no account has, new for each test: the wait of a name is remembered across tests (the clock is shared). */
  let ghost = ''

  beforeAll(async () => {
    env = await startAuthApp()
  })
  beforeEach(() => {
    ghost = uniqueName('ghost')
  })
  afterAll(async () => {
    await env.close()
  })
  afterEach(async () => {
    env.clock.set(new Date(Date.now()))
    await env.query(`update setting set value = '5'::jsonb where key = 'login_limit_account_attempts'`)
    await env.query(`update setting set value = '20'::jsonb where key = 'login_limit_ip_attempts'`)
    await env.query(`update setting set value = '60'::jsonb where key = 'login_limit_window_minutes'`)
    await env.query(`update setting set value = '30'::jsonb where key = 'login_limit_delay_seconds'`)
    await env.query(`update setting set value = '15'::jsonb where key = 'login_limit_delay_max_minutes'`)
  })

  async function failNTimes(client: TestClient, login: string, times: number): Promise<Response[]> {
    const out: Response[] = []
    for (let i = 0; i < times; i += 1) {
      out.push(await client.login(login, `wrong-${String(i)}`))
    }
    return out
  }

  /**
   * How many seconds the next attempt for this name has to wait, from the Retry-After of an attempt that is turned away. A
   * turned-away attempt is not written, so asking does not change the answer. 0 when the attempt would be answered.
   */
  async function waitFor(client: TestClient, login: string): Promise<number> {
    const res = await client.login(login, 'probe, never the password')
    if (res.status !== 429) {
      expect(res.status).toBe(401)
      return 0
    }
    return Number(res.headers.get('retry-after'))
  }

  describe('per login name', () => {
    it('answers five failures at once, then makes the sixth wait 30 seconds, even with the right password; nothing is locked', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('victim') })
      const client = env.client({ ip: freshIp() })
      const failures = await failNTimes(client, account.username, 5)
      expect(failures.map((r) => r.status)).toEqual([401, 401, 401, 401, 401])

      const waiting = await client.login(account.username, TEST_PASSWORD)
      expect(waiting.status).toBe(429)
      expect(waiting.headers.get('retry-after')).toBe('30')
      expect(waiting.headers.getSetCookie()).toEqual([])
      expect(ApiError.parse(await waiting.json()).error.code).toBe('too_many_requests')
      expect(client.cookie).toBeUndefined()

      // Still waiting just before the 30 seconds are over, answered just after: the right password works.
      env.clock.set(new Date(T0.getTime() + 29 * SECOND))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(429)
      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('doubles the wait with each further failure: 30 seconds, 1, 2, 4 and 8 minutes', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('repeat') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 5)
      const waits: number[] = []
      for (let n = 0; n < 5; n += 1) {
        const wait = await waitFor(client, account.username)
        waits.push(wait)
        env.clock.advance(wait * SECOND + 1)
        // The first try after the wait is answered, and (wrong again) makes the next wait twice as long.
        expect((await client.login(account.username, `still wrong ${String(n)}`)).status).toBe(401)
      }
      expect(waits).toEqual([30, 60, 120, 240, 480])
    })

    it('never waits longer than the cap, and the wait is told the same way every time', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '1'::jsonb where key = 'login_limit_account_attempts'`)
      await env.query(`update setting set value = '300'::jsonb where key = 'login_limit_delay_seconds'`)
      await env.query(`update setting set value = '10'::jsonb where key = 'login_limit_delay_max_minutes'`)
      const account = await env.createAccount({ username: uniqueName('capped') })
      const client = env.client({ ip: freshIp() })
      const waits: number[] = []
      expect((await client.login(account.username, 'wrong')).status).toBe(401)
      for (let n = 0; n < 4; n += 1) {
        const wait = await waitFor(client, account.username)
        waits.push(wait)
        env.clock.advance(wait * SECOND + 1)
        expect((await client.login(account.username, 'wrong')).status).toBe(401)
      }
      expect(waits).toEqual([300, 600, 600, 600])
    })

    it('forgets by itself: after an hour without a failure the five free tries are back', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('forgotten') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 8)
      expect(await waitFor(client, account.username)).toBeGreaterThan(0)
      env.clock.set(new Date(T0.getTime() + 61 * MINUTE))
      await failNTimes(client, account.username, 5)
      expect(await waitFor(client, account.username)).toBe(30)
    })

    it('ends the streak with a success: 4 failures, a success, 4 failures is not a wait', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('streak') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 4)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      await failNTimes(client, account.username, 4)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('does not hold up slow guessing: one failure every 13 minutes builds a wait of 30 seconds that is long over', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('slow') })
      const client = env.client({ ip: freshIp() })
      for (let i = 0; i < 12; i += 1) {
        env.clock.set(new Date(T0.getTime() + i * 13 * MINUTE))
        expect((await client.login(account.username, 'wrong')).status).toBe(401)
      }
      env.clock.set(new Date(T0.getTime() + 12 * 13 * MINUTE))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('counts per account across addresses: five addresses, one failure each, and the sixth address waits', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('spread') })
      for (let i = 0; i < 5; i += 1) {
        await env.client({ ip: freshIp() }).login(account.username, 'wrong')
      }
      const sixth = await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)
      expect(sixth.status).toBe(429)
      expect(sixth.headers.get('retry-after')).toBe('30')
      // Another account from the same addresses is not affected.
      const other = await env.createAccount({ username: uniqueName('other') })
      expect((await env.client({ ip: freshIp() }).login(other.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('counts the e-mail address and the username of one account together', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('twoforms') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 3)
      await failNTimes(client, account.email, 2)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(429)
      expect((await client.login(account.email.toUpperCase(), TEST_PASSWORD)).status).toBe(429)
    })

    it('follows the settings: 2 attempts, a base of 10 seconds', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '2'::jsonb where key = 'login_limit_account_attempts'`)
      await env.query(`update setting set value = '10'::jsonb where key = 'login_limit_delay_seconds'`)
      const account = await env.createAccount({ username: uniqueName('strict') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 2)
      const res = await client.login(account.username, TEST_PASSWORD)
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).toBe('10')
      env.clock.set(new Date(T0.getTime() + 11 * SECOND))
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('a setting stored invalid does not loosen the limit: the default applies', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '100000'::jsonb where key = 'login_limit_account_attempts'`)
      const account = await env.createAccount({ username: uniqueName('badlimit') })
      const client = env.client({ ip: freshIp() })
      await failNTimes(client, account.username, 5)
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(429)
    })
  })

  describe('per IP address', () => {
    it('makes the address wait after 20 failures with a 429 and Retry-After, for every account, even a right password', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('bystander') })
      const ip = freshIp()
      const attacker = env.client({ ip })
      // 20 different names, so no name gets 5 failures.
      for (let i = 0; i < 20; i += 1) {
        expect((await attacker.login(`${ghost}-${String(i)}`, 'guess')).status).toBe(401)
      }
      const res = await attacker.login(account.username, TEST_PASSWORD)
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).toBe('30')
      expect(ApiError.parse(await res.json()).error.code).toBe('too_many_requests')
      expect(attacker.cookie).toBeUndefined()

      // Another address is not touched.
      expect((await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)).status).toBe(200)

      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      expect((await attacker.login(account.username, TEST_PASSWORD)).status).toBe(200)
    })

    it('answers a waiting address the same for an existing and an unknown account', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('exists') })
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.login(`${ghost}-${String(i)}`, 'guess')
      }
      const existing = await answerOf(await attacker.login(account.username, 'wrong'))
      const unknown = await answerOf(await attacker.login(`${ghost}-no-such-account`, 'wrong'))
      expect(existing.status).toBe(429)
      expect(existing).toEqual(unknown)
    })

    it('does not write attempts it turned away, so hammering a waiting address does not make the wait longer', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.login(`${ghost}-${String(i)}`, 'guess')
      }
      const count = async () =>
        (await env.query<{ n: string }>(`select count(*) as n from login_attempt where ip = $1`, [ip]))[0]?.n
      expect(await count()).toBe('20')
      for (let i = 0; i < 10; i += 1) {
        expect((await attacker.login(`${ghost}-extra`, 'guess')).status).toBe(429)
      }
      expect(await count()).toBe('20')
      // Answered after one wait, not after 30 minutes of hammering.
      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      expect((await attacker.login(`${ghost}-extra`, 'guess')).status).toBe(401)
    })

    it('doubles for the address too', async () => {
      env.clock.set(T0)
      await env.query(`update setting set value = '3'::jsonb where key = 'login_limit_ip_attempts'`)
      const attacker = env.client({ ip: freshIp() })
      for (let i = 0; i < 3; i += 1) {
        await attacker.login(`${ghost}-${String(i)}`, 'guess')
      }
      expect((await attacker.login(`${ghost}-x`, 'y')).headers.get('retry-after')).toBe('30')
      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      expect((await attacker.login(`${ghost}-another`, 'guess')).status).toBe(401)
      expect((await attacker.login(`${ghost}-x`, 'y')).headers.get('retry-after')).toBe('60')
    })

    it('is not dodged with X-Forwarded-For: only X-Real-IP names the client', async () => {
      env.clock.set(T0)
      const ip = freshIp()
      const attacker = env.client({ ip })
      for (let i = 0; i < 20; i += 1) {
        await attacker.request('POST', '/api/v1/auth/login', {
          json: { login: `${ghost}-${String(i)}`, password: 'guess' },
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
        expect((await rotating.login(`${ghost}-${String(i)}`, 'guess')).status).toBe(401)
      }
      expect((await env.client({ ip: '2001:db8:77:5:ffff::1' }).login(`${ghost}-extra`, 'guess')).status).toBe(429)
      // The next /64 is another subscriber.
      expect((await env.client({ ip: '2001:db8:77:6::1' }).login(`${ghost}-extra`, 'guess')).status).toBe(401)
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
        await anonymous.login(`${ghost}-${String(i)}`, 'guess')
      }
      expect((await anonymous.login(`${ghost}-extra`, 'guess')).status).toBe(429)
      const rows = await env.query<{ ip: string }>(
        `select distinct host(ip) as ip from login_attempt where ip = '0.0.0.0' and not succeeded`,
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('guesses sent at the same moment', () => {
    it('cannot all pass a limit of five: only five are judged, the rest have to wait', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('burst') })
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          env.client({ ip: freshIp() }).login(account.username, `guess-${String(i)}`),
        ),
      )
      expect(results.filter((res) => res.status === 401)).toHaveLength(5)
      expect(results.filter((res) => res.status === 429)).toHaveLength(15)
      const reasons = await env.query<{ reason: string; n: string }>(
        `select reason, count(*) as n from audit_log where account_id = $1 and action = 'login.failed' group by reason order by reason`,
        [account.id],
      )
      expect(reasons).toEqual([{ reason: 'wrong_password', n: '5' }])
      // And the right password has to wait too.
      expect((await env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD)).status).toBe(429)
    })

    it('cannot all pass a limit of twenty for one address: the rest get a 429', async () => {
      env.clock.set(T0)
      const attacker = env.client({ ip: freshIp() })
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => attacker.login(`${ghost}-${String(i)}`, 'guess')),
      )
      expect(results.filter((res) => res.status === 401)).toHaveLength(20)
      expect(results.filter((res) => res.status === 429)).toHaveLength(10)
    })

    it('a right password sent among wrong ones, after the free tries are used up, has to wait like the rest', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('race') })
      await failNTimes(env.client({ ip: freshIp() }), account.username, 5)
      const results = await Promise.all([
        ...Array.from({ length: 5 }, (_, i) =>
          env.client({ ip: freshIp() }).login(account.username, `guess-${String(i)}`),
        ),
        env.client({ ip: freshIp() }).login(account.username, TEST_PASSWORD),
      ])
      expect(results.map((res) => res.status)).toEqual([429, 429, 429, 429, 429, 429])
    })
  })

  describe('one answer whether the account exists (K-004)', () => {
    it('gives identical status, body and headers for an account and a name nobody has, at every step', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('twin') })
      const real = env.client({ ip: freshIp() })
      const ghostClient = env.client({ ip: freshIp() })
      const answers: string[] = []
      // Seven attempts: five that are answered, then two that have to wait.
      for (let i = 0; i < 7; i += 1) {
        const a = await answerOf(await real.login(account.username, `wrong-${String(i)}`))
        const b = await answerOf(await ghostClient.login(`ghost-of-${account.username}`, `wrong-${String(i)}`))
        expect(a).toEqual(b)
        answers.push(`${String(a.status)} ${a.retryAfter ?? '-'}`)
      }
      expect(answers).toEqual(['401 -', '401 -', '401 -', '401 -', '401 -', '429 30', '429 30'])
      // The right password for the waiting account, against a ghost with a "right" password: both wait.
      const rightReal = await answerOf(await real.login(account.username, TEST_PASSWORD))
      expect(rightReal).toEqual(await answerOf(await ghostClient.login(`ghost-of-${account.username}`, TEST_PASSWORD)))
      expect(rightReal.status).toBe(429)

      // The waits grow in step, too: after 31 seconds both are answered, and the next wait is 60 for both.
      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      const a = await answerOf(await real.login(account.username, 'wrong'))
      const b = await answerOf(await ghostClient.login(`ghost-of-${account.username}`, 'wrong'))
      expect(a).toEqual(b)
      const nextA = await answerOf(await real.login(account.username, 'wrong'))
      const nextB = await answerOf(await ghostClient.login(`ghost-of-${account.username}`, 'wrong'))
      expect(nextA).toEqual(nextB)
      expect(nextA.retryAfter).toBe('60')
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

    it('a name that has to wait costs no password check, known or not; a disabled account with the right password costs one', async () => {
      const mock = vi.mocked(verifyPassword)
      env.clock.set(T0)
      const waiting = await env.createAccount({ username: uniqueName('waitingwork') })
      const disabled = await env.createAccount({ username: uniqueName('disabledwork'), status: 'disabled' })
      await failNTimes(env.client({ ip: freshIp() }), waiting.username, 5)
      await failNTimes(env.client({ ip: freshIp() }), `${ghost}-waiting-work`, 5)
      mock.mockClear()
      await env.client({ ip: freshIp() }).login(waiting.username, TEST_PASSWORD)
      await env.client({ ip: freshIp() }).login(`${ghost}-waiting-work`, TEST_PASSWORD)
      expect(mock).toHaveBeenCalledTimes(0)
      await env.client({ ip: freshIp() }).login(disabled.username, TEST_PASSWORD)
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('records the attempts with a keyed hash of the name and never the name: the table has an account id, a hash or nothing', async () => {
      const account = await env.createAccount({ username: uniqueName('recorded') })
      const ip = freshIp()
      await env.client({ ip }).login(account.username, 'wrong')
      await env.client({ ip }).login('typed-a-password-here', 'wrong')
      await env.client({ ip }).login(account.username.toUpperCase(), TEST_PASSWORD)
      const rows = await env.query<{
        account_id: string | null
        login_hash: string | null
        succeeded: boolean
        action: string
      }>(`select account_id, login_hash, succeeded, action from login_attempt where ip = $1 order by created_at, id`, [
        ip,
      ])
      expect(rows.map(({ account_id, succeeded, action }) => ({ account_id, succeeded, action }))).toEqual([
        { account_id: account.id, succeeded: false, action: 'login' },
        { account_id: null, succeeded: false, action: 'login' },
        { account_id: account.id, succeeded: true, action: 'login' },
      ])
      for (const row of rows) {
        expect(row.login_hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
      }
      // The same name written differently is the same hash; another name is another.
      expect(rows[0]?.login_hash).toBe(rows[2]?.login_hash)
      expect(rows[1]?.login_hash).not.toBe(rows[0]?.login_hash)
      const everything = JSON.stringify(await env.query(`select * from login_attempt where ip = $1`, [ip]))
      expect(everything).not.toContain('typed-a-password-here')
      expect(everything).not.toContain(account.username)
      const columns = await env.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'login_attempt'`,
      )
      expect(columns.map((c) => c.column_name).sort()).toEqual([
        'account_id',
        'action',
        'created_at',
        'id',
        'ip',
        'login_hash',
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
      expect((await limiter.check('register', { ip })).ip.delayed).toBe(false)
      await limiter.begin('register', { ip })
      const status = await limiter.check('register', { ip })
      expect(status.ip.delayed).toBe(true)
      expect(status.ip.until).toEqual(new Date(T0.getTime() + 30 * SECOND))
      // Registering many times does not hold up login, nor lost password.
      expect((await limiter.check('login', { ip })).ip.delayed).toBe(false)
      expect((await limiter.check('password_lost', { ip })).ip.delayed).toBe(false)
      // And the wait ends by itself.
      env.clock.set(new Date(T0.getTime() + 31 * SECOND))
      expect((await limiter.check('register', { ip })).ip.delayed).toBe(false)
    })

    it('limits lost-password requests for one account from many addresses, and tells the account apart from the address', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('mailbomb') })
      const limiter = env.services.limiter
      for (let i = 0; i < 5; i += 1) {
        await limiter.begin('password_lost', { ip: freshIp(), accountId: account.id })
      }
      const status = await limiter.check('password_lost', { ip: freshIp(), accountId: account.id })
      expect(status.account.delayed).toBe(true)
      expect(status.ip.delayed).toBe(false)
      expect((await limiter.check('password_lost', { ip: freshIp() })).account.delayed).toBe(false)
    })

    it('counts a name that has no account yet, and keeps its history when the account is made', async () => {
      env.clock.set(T0)
      const limiter = env.services.limiter
      const name = uniqueName('later')
      for (let i = 0; i < 3; i += 1) {
        await limiter.begin('register', { ip: freshIp(), login: name })
      }
      const account = await env.createAccount({ username: name })
      // Two more, now with the account: five in all, so the sixth waits (no fresh start, which would tell the account exists).
      for (let i = 0; i < 2; i += 1) {
        await limiter.begin('register', { ip: freshIp(), accountId: account.id, login: name })
      }
      expect(
        (await limiter.check('register', { ip: freshIp(), accountId: account.id, login: name })).account.delayed,
      ).toBe(true)
      expect((await limiter.check('register', { ip: freshIp(), login: name })).account.delayed).toBe(true)
    })

    it('clear ends the streak of an account for the actions given, and leaves the address and the other actions alone', async () => {
      env.clock.set(T0)
      const account = await env.createAccount({ username: uniqueName('cleared') })
      const limiter = env.services.limiter
      const ip = freshIp()
      for (let i = 0; i < 5; i += 1) {
        await limiter.begin('login', { ip: freshIp(), accountId: account.id })
        await limiter.begin('mfa', { ip: freshIp(), accountId: account.id })
      }
      expect((await limiter.check('login', { ip, accountId: account.id })).account.delayed).toBe(true)
      await limiter.clear(account.id, ip, ['login'])
      expect((await limiter.check('login', { ip, accountId: account.id })).account.delayed).toBe(false)
      expect((await limiter.check('mfa', { ip, accountId: account.id })).account.delayed).toBe(true)
      // The marker is not counted against the address that wrote it.
      expect((await limiter.check('login', { ip })).ip.failures).toBe(0)
      // The five free tries start over.
      for (let i = 0; i < 5; i += 1) {
        expect((await limiter.begin('login', { ip: freshIp(), accountId: account.id })).attemptId).not.toBeNull()
      }
      expect((await limiter.begin('login', { ip: freshIp(), accountId: account.id })).attemptId).toBeNull()
    })
  })
})
