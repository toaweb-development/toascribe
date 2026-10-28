// The sidebar's image and SEO fields (M1.3): «Fremhevet bilde» (K-070) and the SEO panel (K-105) on posts and pages. Both images are
// media ids the account may see, never addresses; a private file of someone else, a file that is not an image or an unknown id is
// refused. The item answers with the images in `media`, so the editor can draw them.
import { ContentItem, MediaItem } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import * as f from './media-fixtures.ts'

noticeIfSkipped('content featured image and SEO')

describe.skipIf(TEST_DATABASE_URL === undefined)('featured image and SEO (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let author: TestClient
  let other: TestClient

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'fs-author', role: 'author' })
    await env.createAccount({ username: 'fs-other', role: 'author' })
    author = env.client({ ip: '203.0.113.51' })
    other = env.client({ ip: '203.0.113.52' })
    expect((await author.login('fs-author', TEST_PASSWORD)).status).toBe(200)
    expect((await other.login('fs-other', TEST_PASSWORD)).status).toBe(200)
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

  it('stores a featured image and the SEO panel, and answers with both images in media', async () => {
    const featured = await upload(author, f.PNG, 'fremhevet.png')
    const sharing = await upload(author, f.JPEG, 'deling.jpg')
    const res = await author.post('/api/v1/content', {
      type: 'post',
      title: 'Med bilde',
      featuredMediaId: featured.id,
      seo: { title: 'Søketittel', description: '  Kort beskrivelse.  ', image: sharing.id },
    })
    expect(res.status, await res.clone().text()).toBe(201)
    const post = ContentItem.parse(await res.json())
    expect(post.featuredMediaId).toBe(featured.id)
    expect(post.seo).toEqual({ title: 'Søketittel', description: 'Kort beskrivelse.', image: sharing.id })
    expect(post.media.map((ref) => ref.id).sort()).toEqual([featured.id, sharing.id].sort())
    // Removed again: null and an empty panel.
    const cleared = ContentItem.parse(
      await (await author.patch(`/api/v1/content/${post.id}`, { featuredMediaId: null, seo: {} })).json(),
    )
    expect(cleared).toMatchObject({ featuredMediaId: null, seo: {}, media: [] })
  })

  it('includes the featured image in a list only when asked (include=featured_media, K-251)', async () => {
    const image = await upload(author, f.PNG, 'liste.png')
    const made = (await (
      await author.post('/api/v1/content', { type: 'post', title: 'Med bilde', featuredMediaId: image.id })
    ).json()) as {
      id: string
    }
    interface Listed {
      items: { id: string; featuredMedia?: { id: string } | null; authors: unknown[]; tags: unknown[] }[]
    }
    const plain = (await (await author.get('/api/v1/content?type=post&status=all')).json()) as Listed
    expect(plain.items.find((item) => item.id === made.id)).not.toHaveProperty('featuredMedia')
    const asked = (await (
      await author.get('/api/v1/content?type=post&status=all&include=author,terms,featured_media')
    ).json()) as Listed
    const item = asked.items.find((entry) => entry.id === made.id)
    expect(item?.featuredMedia?.id).toBe(image.id)
    expect(item?.authors).toHaveLength(1)
    expect((await author.get('/api/v1/content?type=post&include=everything')).status).toBe(400)
  })

  it('refuses an image the account may not see, a file that is not an image, and an unknown id', async () => {
    const secret = await upload(other, f.PNG, 'privat.png')
    expect((await other.patch(`/api/v1/media/${secret.id}`, { visibility: 'private' })).status).toBe(200)
    const pdf = await upload(author, f.PDF, 'dokument.pdf')
    for (const id of [secret.id, pdf.id, '0198a3c2-0000-7000-8000-0000000000ab']) {
      const res = await author.post('/api/v1/content', { type: 'post', title: 'Nei', featuredMediaId: id })
      expect(res.status, id).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_media')
      const seo = await author.post('/api/v1/content', { type: 'post', title: 'Nei', seo: { image: id } })
      expect(seo.status, id).toBe(400)
    }
  })

  it('saves the SEO panel unchanged when its image was deleted since', async () => {
    const sharing = await upload(author, f.PNG, 'slettes.png')
    const post = ContentItem.parse(
      await (
        await author.post('/api/v1/content', { type: 'post', title: 'Deling', seo: { image: sharing.id } })
      ).json(),
    )
    expect((await author.delete(`/api/v1/media/${sharing.id}`)).status).toBe(204)
    const res = await author.patch(`/api/v1/content/${post.id}`, { title: 'Ny tittel', seo: { image: sharing.id } })
    expect(res.status, await res.clone().text()).toBe(200)
  })

  it('caps the SEO title and description, and takes no other field', async () => {
    const long = await author.post('/api/v1/content', { type: 'post', seo: { title: 'x'.repeat(201) } })
    expect(long.status).toBe(400)
    const extra = await author.post('/api/v1/content', { type: 'post', seo: { keywords: 'nei' } })
    expect(extra.status).toBe(400)
  })
})
