// account.preferences (M0.5): defaults, a partial update that keeps the rest, keys a later version adds, and PATCH /me/preferences.
import { DEFAULT_PREFERENCES, MeResponse, Preferences } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readPreferences } from '../src/services/me.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('preferences')

describe('readPreferences', () => {
  it('gives the defaults for an empty object, nothing, or something that is not an object', () => {
    expect(readPreferences({})).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences('ocean')).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences(['ocean'])).toEqual(DEFAULT_PREFERENCES)
    expect(DEFAULT_PREFERENCES).toEqual({
      adminColorScheme: 'default',
      showToolbarOnSite: true,
      dismissedWelcome: false,
    })
  })

  it('reads each key on its own: a bad value falls back, the good ones stay, unknown keys are not returned', () => {
    expect(
      readPreferences({
        adminColorScheme: 'pink',
        showToolbarOnSite: false,
        dismissedWelcome: 'yes',
        screenOptions: { x: 1 },
      }),
    ).toEqual({ adminColorScheme: 'default', showToolbarOnSite: false, dismissedWelcome: false })
    expect(readPreferences({ adminColorScheme: 'midnight' }).adminColorScheme).toBe('midnight')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('preferences (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let counter = 0

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  async function signedIn(role: 'administrator' | 'subscriber' = 'subscriber') {
    counter += 1
    const account = await env.createAccount({ username: `prefs${String(counter)}`, role })
    const client = env.client()
    await client.login(account.username, TEST_PASSWORD)
    return { account, client }
  }

  const stored = async (id: string) =>
    (
      await env.query<{ preferences: Record<string, unknown> }>('select preferences from account where id = $1', [id])
    )[0]?.preferences

  it('puts the defaults in GET /me for an account that never saved any', async () => {
    const { account, client } = await signedIn()
    const res = await client.get('/api/v1/me')
    expect(MeResponse.parse(await res.json()).preferences).toEqual(DEFAULT_PREFERENCES)
    expect(await stored(account.id)).toEqual({})
  })

  it('changes what is sent, keeps the other keys, and returns all of them', async () => {
    const { account, client } = await signedIn()
    const first = await client.patch('/api/v1/me/preferences', { adminColorScheme: 'ocean' })
    expect(first.status).toBe(200)
    expect(Preferences.parse(await first.json())).toEqual({ ...DEFAULT_PREFERENCES, adminColorScheme: 'ocean' })

    const second = await client.patch('/api/v1/me/preferences', { dismissedWelcome: true, showToolbarOnSite: false })
    expect(Preferences.parse(await second.json())).toEqual({
      adminColorScheme: 'ocean',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
    // Only the keys that were sent are stored.
    expect(await stored(account.id)).toEqual({
      adminColorScheme: 'ocean',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
    expect(MeResponse.parse(await (await client.get('/api/v1/me')).json()).preferences).toEqual({
      adminColorScheme: 'ocean',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
  })

  it('keeps keys a later version added, and reads a stored bad value as the default', async () => {
    const { account, client } = await signedIn()
    await env.query(`update account set preferences = $2::jsonb where id = $1`, [
      account.id,
      JSON.stringify({ screenOptions: { posts: ['title'] }, adminColorScheme: 'pink', showToolbarOnSite: false }),
    ])
    const res = await client.patch('/api/v1/me/preferences', { dismissedWelcome: true })
    expect(Preferences.parse(await res.json())).toEqual({
      adminColorScheme: 'default',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
    expect(await stored(account.id)).toEqual({
      screenOptions: { posts: ['title'] },
      adminColorScheme: 'pink',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
  })

  it('does not lose a key when two requests change different keys at once', async () => {
    const { account, client } = await signedIn()
    const answers = await Promise.all([
      client.patch('/api/v1/me/preferences', { adminColorScheme: 'light' }),
      client.patch('/api/v1/me/preferences', { showToolbarOnSite: false }),
      client.patch('/api/v1/me/preferences', { dismissedWelcome: true }),
    ])
    expect(answers.map((res) => res.status)).toEqual([200, 200, 200])
    expect(await stored(account.id)).toEqual({
      adminColorScheme: 'light',
      showToolbarOnSite: false,
      dismissedWelcome: true,
    })
  })

  it.each([
    ['an unknown scheme', { adminColorScheme: 'pink' }],
    ['a scheme that is not text', { adminColorScheme: 3 }],
    ['a toolbar flag that is not a boolean', { showToolbarOnSite: 'yes' }],
    ['an unknown key', { somethingElse: true }],
    ['an empty body', {}],
    ['a key beside a good one', { adminColorScheme: 'light', isAdmin: true }],
  ])('answers 400 for %s and changes nothing', async (_name, body) => {
    const { account, client } = await signedIn()
    const res = await client.patch('/api/v1/me/preferences', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'validation_error' } })
    expect(await stored(account.id)).toEqual({})
  })

  it('answers 403 without the CSRF token or with a wrong one, 401 without a session', async () => {
    const { account, client } = await signedIn()
    expect((await client.patch('/api/v1/me/preferences', { adminColorScheme: 'light' }, { csrf: 'none' })).status).toBe(
      403,
    )
    expect(
      (await client.patch('/api/v1/me/preferences', { adminColorScheme: 'light' }, { csrf: 'wrong' })).status,
    ).toBe(403)
    expect(await stored(account.id)).toEqual({})
    const anonymous = env.client()
    expect(
      (await anonymous.patch('/api/v1/me/preferences', { adminColorScheme: 'light' }, { csrf: 'none' })).status,
    ).toBe(401)
  })

  it('refuses a request from another site', async () => {
    const { client } = await signedIn()
    const res = await client.patch(
      '/api/v1/me/preferences',
      { adminColorScheme: 'light' },
      { origin: 'https://evil.example' },
    )
    expect(res.status).toBe(400)
  })
})
