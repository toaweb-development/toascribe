// GET and PATCH /me (K-011): the profile fields, and only those.
import { ApiError, MeResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('me')

describe.skipIf(TEST_DATABASE_URL === undefined)('profile (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let counter = 0

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  async function signedIn(role: 'author' | 'subscriber' = 'author') {
    counter += 1
    const account = await env.createAccount({ username: `profile${String(counter)}`, role })
    const client = env.client()
    await client.login(account.username, TEST_PASSWORD)
    return { account, client }
  }

  const stored = async (id: string) =>
    (
      await env.query<{
        display_name: string
        email: string
        username: string
        profile: Record<string, unknown>
        status: string
      }>('select display_name, email, username, profile, status from account where id = $1', [id])
    )[0]

  async function me(client: TestClient) {
    return MeResponse.parse(await (await client.get('/api/v1/me')).json())
  }

  it('shows the account, its roles and an empty profile for a new account, and nothing secret', async () => {
    const { account, client } = await signedIn()
    const res = await client.get('/api/v1/me')
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = MeResponse.parse(JSON.parse(text))
    expect(body).toMatchObject({
      id: account.id,
      username: account.username,
      email: account.email,
      displayName: account.username,
      roles: ['author'],
      profile: { firstName: '', lastName: '', nickname: '', website: '', bio: '', displayNameChoice: 'username' },
    })
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual([
      'capabilities',
      'displayName',
      'email',
      'id',
      'locale',
      'profile',
      'roles',
      'username',
    ])
    expect(text).not.toMatch(/password|hash|token|argon/i)
  })

  it('changes the fields that are sent and keeps the others', async () => {
    const { account, client } = await signedIn()
    const first = await client.patch('/api/v1/me', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      website: 'https://ada.example/about',
      bio: 'Line one\nLine two',
    })
    expect(first.status).toBe(200)
    expect(MeResponse.parse(await first.json()).profile).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      nickname: '',
      website: 'https://ada.example/about',
      bio: 'Line one\nLine two',
      displayNameChoice: 'username',
    })
    const second = await client.patch('/api/v1/me', { nickname: 'countess' })
    expect(MeResponse.parse(await second.json()).profile).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      nickname: 'countess',
      website: 'https://ada.example/about',
    })
    expect((await me(client)).profile.bio).toBe('Line one\nLine two')
    // The display name was not asked to change.
    expect((await stored(account.id))?.display_name).toBe(account.username)
    // Exactly the six keys are stored.
    expect(Object.keys((await stored(account.id))?.profile ?? {}).sort()).toEqual([
      'bio',
      'displayNameChoice',
      'firstName',
      'lastName',
      'nickname',
      'website',
    ])
  })

  it('builds the display name from the chosen part, as WordPress does', async () => {
    const { account, client } = await signedIn()
    await client.patch('/api/v1/me', { firstName: 'Ada', lastName: 'Lovelace', nickname: 'countess' })
    const expected: Record<string, string> = {
      first_name: 'Ada',
      last_name: 'Lovelace',
      first_last: 'Ada Lovelace',
      last_first: 'Lovelace Ada',
      nickname: 'countess',
      username: account.username,
    }
    for (const [choice, name] of Object.entries(expected)) {
      const res = await client.patch('/api/v1/me', { displayNameChoice: choice })
      expect(res.status, choice).toBe(200)
      const body = MeResponse.parse(await res.json())
      expect(body.displayName, choice).toBe(name)
      expect((await stored(account.id))?.display_name, choice).toBe(name)
      expect((await me(client)).displayName).toBe(name)
    }
    // The name follows a change of a part it is made from.
    await client.patch('/api/v1/me', { displayNameChoice: 'first_last' })
    expect(MeResponse.parse(await (await client.patch('/api/v1/me', { lastName: 'King' })).json()).displayName).toBe(
      'Ada King',
    )
  })

  it('refuses a display name that would be empty, and changes nothing', async () => {
    const { account, client } = await signedIn()
    const res = await client.patch('/api/v1/me', { displayNameChoice: 'nickname', bio: 'should not be saved either' })
    expect(res.status).toBe(400)
    expect(ApiError.parse(await res.json()).error.code).toBe('validation_error')
    expect((await stored(account.id))?.display_name).toBe(account.username)
    expect((await me(client)).profile.bio).toBe('')
  })

  it('cannot change what a profile does not hold: e-mail, username, roles, status, capabilities, id', async () => {
    const { account, client } = await signedIn('subscriber')
    for (const field of [
      'email',
      'username',
      'roles',
      'role',
      'capabilities',
      'status',
      'id',
      'passwordHash',
      'password',
      'displayName',
      'locale',
      'isAdmin',
    ]) {
      const res = await client.patch('/api/v1/me', {
        nickname: 'fine',
        [field]: field === 'roles' ? ['administrator'] : 'x@evil.example',
      })
      expect(res.status, field).toBe(400)
      expect(ApiError.parse(await res.json()).error.code).toBe('validation_error')
    }
    const row = await stored(account.id)
    expect(row).toMatchObject({
      email: account.email,
      username: account.username,
      status: 'active',
      display_name: account.username,
    })
    expect(row?.profile).toEqual({})
    expect((await me(client)).roles).toEqual(['subscriber'])
  })

  it('refuses an empty body, a body that is not an object, and invalid values', async () => {
    const { client } = await signedIn()
    for (const bad of [
      {},
      [],
      'text',
      5,
      null,
      { firstName: 5 },
      { firstName: null },
      { bio: ['a'] },
      { displayNameChoice: 'everything' },
      { displayNameChoice: 'username ' },
    ]) {
      const res = await client.patch('/api/v1/me', bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('refuses control characters in names, and too long values', async () => {
    const { client } = await signedIn()
    for (const bad of [
      { firstName: 'Ada\nLovelace' },
      { lastName: 'A\tB' },
      { nickname: 'x\u0000y' },
      { firstName: 'x'.repeat(101) },
      { bio: 'x'.repeat(5001) },
      { bio: 'bell\u0007' },
    ]) {
      expect((await client.patch('/api/v1/me', bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400)
    }
    expect((await client.patch('/api/v1/me', { firstName: 'x'.repeat(100), bio: 'x'.repeat(5000) })).status).toBe(200)
  })

  it('accepts a website that is an http or https address or empty, and nothing else', async () => {
    const { client } = await signedIn()
    for (const good of ['https://example.com', 'http://example.com/a?b=c#d', 'https://例え.jp/', '']) {
      expect((await client.patch('/api/v1/me', { website: good })).status, good).toBe(200)
    }
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com',
      'file:///etc/passwd',
      '//example.com',
      'example.com',
      'https://',
      `https://example.com/${'a'.repeat(2000)}`,
    ]) {
      expect((await client.patch('/api/v1/me', { website: bad })).status, bad).toBe(400)
    }
    // An empty string clears it.
    await client.patch('/api/v1/me', { website: 'https://example.com' })
    expect(MeResponse.parse(await (await client.patch('/api/v1/me', { website: '' })).json()).profile.website).toBe('')
  })

  it('shows HTML as text: the api stores and returns what was sent, without interpreting it', async () => {
    const { client } = await signedIn()
    const text = '<script>alert(1)</script> & "quotes"'
    await client.patch('/api/v1/me', { bio: text, nickname: '<b>bold</b>' })
    const body = await me(client)
    expect(body.profile.bio).toBe(text)
    expect(body.profile.nickname).toBe('<b>bold</b>')
  })

  it('changes only the account that asked', async () => {
    const mine = await signedIn()
    const theirs = await signedIn()
    await mine.client.patch('/api/v1/me', { firstName: 'Mine' })
    expect((await me(theirs.client)).profile.firstName).toBe('')
    expect((await stored(theirs.account.id))?.profile).toEqual({})
  })

  it('shows an empty profile, not an error, when the stored JSON is not in the expected shape', async () => {
    const { account, client } = await signedIn()
    await env.query(
      `update account set profile = '{"firstName": 5, "website": ["x"], "unknown": true, "bio": "kept"}'::jsonb where id = $1`,
      [account.id],
    )
    const body = await me(client)
    expect(body.profile).toEqual({
      firstName: '',
      lastName: '',
      nickname: '',
      website: '',
      bio: '',
      displayNameChoice: 'username',
    })
    await env.query(`update account set profile = '[]'::jsonb where id = $1`, [account.id])
    expect((await me(client)).profile.firstName).toBe('')
  })

  it("keeps the account's locale and roles in the answer to a change", async () => {
    const { account, client } = await signedIn()
    await env.query(`update account set locale = 'nb' where id = $1`, [account.id])
    const res = await client.patch('/api/v1/me', { nickname: 'n' })
    expect(MeResponse.parse(await res.json())).toMatchObject({
      locale: 'nb',
      roles: ['author'],
      username: account.username,
    })
  })
})
