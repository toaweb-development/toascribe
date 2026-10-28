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

  const tokenFor = async () =>
    ((await (await env.client().get('/api/v1/auth/options')).json()) as { formToken: string }).formToken
  const made = async (username: string) =>
    (await env.query(`select 1 from account where username = $1`, [username])).length

  it('takes a form sent after a person would have filled it in, with the hidden field empty', async () => {
    const formToken = await tokenFor()
    env.clock.advance(2500)
    const res = await env.client({ ip: ip() }).post('/api/v1/auth/register', {
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
      async () => ({ formToken: await tokenFor(), wait: 2500, website: 'http://spam.example' }),
    ],
    ['sent at once', async () => ({ formToken: await tokenFor(), wait: 0 })],
    ['a token over an hour old', async () => ({ formToken: await tokenFor(), wait: 61 * 60 * 1000 })],
    ['a token made up', () => Promise.resolve({ formToken: `${String(Date.now() - 10_000)}.made-up`, wait: 0 })],
  ])('refuses %s, and makes nothing', async (name, build) => {
    const { formToken, wait, website } = (await build()) as { formToken: string; wait: number; website?: string }
    env.clock.advance(wait)
    const username = `bot-${String(n)}`
    const res = await env.client({ ip: ip() }).post('/api/v1/auth/register', {
      username,
      email: `${username}@example.test`,
      formToken,
      ...(website === undefined ? {} : { website }),
    })
    expect(res.status, name).toBe(400)
    expect(await res.text()).toContain('form_rejected')
    expect(await made(username)).toBe(0)
  })

  it('refuses a form without a token', async () => {
    const res = await env
      .client({ ip: ip() })
      .post('/api/v1/auth/register', { username: 'utentoken', email: 'u@example.test' })
    expect(res.status).toBe(400)
  })
})
