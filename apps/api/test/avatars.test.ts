// Profile pictures (M1.8, K-015, K-236): an image from the library that anyone may see, or the initials (null). Gravatar only when
// «Personvern» turns it on; it is off by default, so no hash of an e-mail address leaves the site unless the admin chose it.
import { MeResponse, MediaItem, ResolveResponse, UserListResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { gravatarUrl } from '../src/services/avatars.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import * as f from './media-fixtures.ts'
import { setSetting } from './flows.ts'

noticeIfSkipped('avatars')

describe.skipIf(TEST_DATABASE_URL === undefined)('avatars (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let author: TestClient
  let other: TestClient
  let admin: TestClient
  let visitor: TestClient
  let nicename: string

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'av-author', role: 'author', email: 'Av.Author@Example.test' })
    await env.createAccount({ username: 'av-other', role: 'author' })
    await env.createAccount({ username: 'av-admin', role: 'administrator' })
    author = env.client({ ip: '203.0.113.71' })
    other = env.client({ ip: '203.0.113.72' })
    admin = env.client({ ip: '203.0.113.73' })
    visitor = env.client({ ip: '203.0.113.74' })
    expect((await author.login('av-author', TEST_PASSWORD)).status).toBe(200)
    expect((await other.login('av-other', TEST_PASSWORD)).status).toBe(200)
    expect((await admin.login('av-admin', TEST_PASSWORD)).status).toBe(200)
    nicename =
      (await env.query<{ nicename: string }>(`select nicename from account where username = 'av-author'`))[0]
        ?.nicename ?? ''
    const post = await author.post('/api/v1/content', { type: 'post', title: 'Med bilde av meg', status: 'publish' })
    expect(post.status, await post.clone().text()).toBe(201)
  })

  afterAll(async () => {
    await env.close()
  })

  async function upload(client: TestClient, bytes: Uint8Array, name: string): Promise<MediaItem> {
    const form = new FormData()
    form.append('file', new File([bytes.slice().buffer], name))
    const res = await env.app.request('/api/v1/media', {
      method: 'POST',
      body: form,
      headers: {
        origin: TEST_ORIGIN,
        ...(client.cookie === undefined ? {} : { cookie: client.cookie }),
        ...(client.csrfToken === undefined ? {} : { 'x-csrf-token': client.csrfToken }),
      },
    })
    expect(res.status).toBe(201)
    return MediaItem.parse(await res.json())
  }

  async function me(client: TestClient): Promise<MeResponse> {
    return MeResponse.parse(await (await client.get('/api/v1/me')).json())
  }

  async function authorAvatar(): Promise<string | null | undefined> {
    const res = await visitor.get(`/api/v1/public/resolve?path=${encodeURIComponent(`/author/${nicename}/`)}`)
    expect(res.status).toBe(200)
    const body = ResolveResponse.parse(await res.json())
    if (body.kind !== 'archive' || body.archive.type !== 'author') throw new Error('not an author archive')
    return body.archive.author.avatarUrl
  }

  it('has no picture and no Gravatar by default', async () => {
    expect((await me(author)).avatarUrl).toBeNull()
    const listed = UserListResponse.parse(await (await admin.get('/api/v1/users?per_page=100')).json())
    for (const user of listed.users) expect(user.avatarUrl).toBeNull()
    expect(await authorAvatar()).toBeNull()
  })

  it('takes a public image of the library as the picture, and shows it everywhere', async () => {
    const image = await upload(author, f.PNG, 'meg.png')
    const res = await author.patch('/api/v1/me', { avatarId: image.id })
    expect(res.status, await res.clone().text()).toBe(200)
    const body = MeResponse.parse(await res.json())
    expect(body.profile.avatarId).toBe(image.id)
    expect(body.avatarUrl).toMatch(/^\/uploads\//)
    const listed = UserListResponse.parse(await (await admin.get('/api/v1/users?per_page=100')).json())
    expect(listed.users.find((user) => user.username === 'av-author')?.avatarUrl).toBe(body.avatarUrl)
    expect(await authorAvatar()).toBe(body.avatarUrl)
    // A file made private afterwards is no longer shown, and nothing leaks its private address.
    expect((await author.patch(`/api/v1/media/${image.id}`, { visibility: 'private' })).status).toBe(200)
    expect((await me(author)).avatarUrl).toBeNull()
    expect(await authorAvatar()).toBeNull()
    // Removed: initials again.
    expect(
      MeResponse.parse(await (await author.patch('/api/v1/me', { avatarId: null })).json()).profile.avatarId,
    ).toBeNull()
  })

  it('refuses a private file, a file that is not an image and an unknown id', async () => {
    const hidden = await upload(other, f.PNG, 'privat.png')
    expect((await other.patch(`/api/v1/media/${hidden.id}`, { visibility: 'private' })).status).toBe(200)
    const text = await upload(author, f.TEXT, 'tall.csv')
    for (const id of [hidden.id, text.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await author.patch('/api/v1/me', { avatarId: id })
      expect(res.status, id).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_media')
    }
    expect((await me(author)).profile.avatarId).toBeNull()
  })

  it('uses Gravatar only when «Personvern» turns it on, with the hash of the trimmed lower-case address', async () => {
    expect(gravatarUrl(' Av.Author@Example.test ')).toBe(gravatarUrl('av.author@example.test'))
    expect(gravatarUrl('av.author@example.test')).toMatch(
      /^https:\/\/secure\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=96&d=404$/,
    )
    expect((await admin.patch('/api/v1/settings/privacy', { avatar_gravatar: true })).status).toBe(200)
    try {
      expect((await me(author)).avatarUrl).toBe(gravatarUrl('av.author@example.test'))
      expect(await authorAvatar()).toBe(gravatarUrl('av.author@example.test'))
      // «Vis avatarer» off: the public answer has no picture and reads no e-mail address.
      await setSetting(env, 'show_avatars', false)
      expect(await authorAvatar()).toBeUndefined()
    } finally {
      await admin.patch('/api/v1/settings/privacy', { avatar_gravatar: false })
      await setSetting(env, 'show_avatars', true)
    }
  })
})
