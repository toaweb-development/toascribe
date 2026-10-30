// K-006: registration's spam checks, with no outside service. A form sent with the token the options gave and the hidden field
// empty goes through; a filled hidden field, a token that is too new, too old, made up or missing is refused (400 form_rejected),
// and nothing is made. The rate limit of M0.4 counts these attempts too (register.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('register spam')

describe.skipIf(TEST_DATABASE_URL === undefined)('registration spam checks (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let n = 0
  const ip = () => `198.51.100.${String(100 + (n++ % 100))}`

  beforeAll(async () => {
    // The real minimum: a form must be two seconds old.
    env = await startAuthApp({ registerFormMinMs: 2000 })
    await env.query(`update setting set value = 'true'::jsonb where key = 'users_can_register'`)
  })
  afterAll(async () => {
    await env.close()
  })

  /** The token the form gets when it is drawn for `address` (a token is bound to the address that asked for it). */
  const tokenFor = async (address: string) =>
    ((await (await env.client({ ip: address }).get('/api/v1/auth/options')).json()) as { formToken: string }).formToken
  const made = async (username: string) =>
    (await env.query(`select 1 from account where username = $1`, [username])).length

  it('takes a form sent after a person would have filled it in, with the hidden field empty', async () => {
    const address = ip()
    const formToken = await tokenFor(address)
    env.clock.advance(2500)
    const res = await env.client({ ip: address }).post('/api/v1/auth/register', {
      username: 'ekte-person',
      email: 'ekte@example.test',
      formToken,
      website: '',
    })
    expect(res.status).toBe(202)
    expect(await made('ekte-person')).toBe(1)
  })

  it.each([
    [
      'the hidden field filled',
      async (address: string) => ({ formToken: await tokenFor(address), wait: 2500, website: 'http://spam.example' }),
    ],
    ['sent at once', async (address: string) => ({ formToken: await tokenFor(address), wait: 0 })],
    [
      'a token over an hour old',
      async (address: string) => ({ formToken: await tokenFor(address), wait: 61 * 60 * 1000 }),
    ],
    ['a token made up', () => Promise.resolve({ formToken: `${String(Date.now() - 10_000)}.made-up`, wait: 0 })],
    // One fetched token does not open registration for every address a bot has.
    ['a token fetched from another address', async () => ({ formToken: await tokenFor(ip()), wait: 2500 })],
  ])('refuses %s, and makes nothing', async (name, build) => {
    const address = ip()
    const { formToken, wait, website } = (await build(address)) as {
      formToken: string
      wait: number
      website?: string
    }
    env.clock.advance(wait)
    const username = `bot-${String(n)}`
    const res = await env.client({ ip: address }).post('/api/v1/auth/register', {
      username,
      email: `${username}@example.test`,
      formToken,
      ...(website === undefined ? {} : { website }),
    })
    expect(res.status, name).toBe(400)
    expect(await res.text()).toContain('form_rejected')
    expect(await made(username)).toBe(0)
  })

  it('takes a token once: a second form with it, from the same address, is refused and makes nothing (M2.1)', async () => {
    const address = ip()
    const formToken = await tokenFor(address)
    env.clock.advance(2500)
    const send = (username: string) =>
      env
        .client({ ip: address })
        .post('/api/v1/auth/register', { username, email: `${username}@example.test`, formToken })
    expect((await send('forste-bruk')).status).toBe(202)
    const again = await send('andre-bruk')
    expect(again.status).toBe(400)
    expect(await again.text()).toContain('form_rejected')
    expect(await made('forste-bruk')).toBe(1)
    expect(await made('andre-bruk')).toBe(0)
    // Kept as its hash only, and for the token's own hour at most.
    const [row] = await env.query<{ token_hash: string; left: number }>(
      `select token_hash, extract(epoch from expires_at - now())::int as left from register_form_use order by expires_at desc limit 1`,
    )
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.token_hash).not.toContain(formToken)
  })

  it('uses the token on a send that fails for another reason (a taken name); a new token then works (M2.1)', async () => {
    const address = ip()
    await env.createAccount({ username: 'opptatt-navn', role: 'subscriber' })
    const first = await tokenFor(address)
    env.clock.advance(2500)
    const taken = await env
      .client({ ip: address })
      .post('/api/v1/auth/register', { username: 'opptatt-navn', email: 'ny@example.test', formToken: first })
    expect(taken.status).toBe(409)
    const second = await tokenFor(address)
    env.clock.advance(2500)
    const again = await env
      .client({ ip: address })
      .post('/api/v1/auth/register', { username: 'ledig-navn', email: 'ny@example.test', formToken: second })
    expect(again.status).toBe(202)
    expect(await made('ledig-navn')).toBe(1)
  })

  it('refuses a form without a token', async () => {
    const res = await env
      .client({ ip: ip() })
      .post('/api/v1/auth/register', { username: 'utentoken', email: 'u@example.test' })
    expect(res.status).toBe(400)
  })
})
