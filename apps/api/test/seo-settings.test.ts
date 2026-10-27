// «Deling og søkemotorer» (M1.6, K-224): the sharing image and the publisher on «Lesing», checked on save, and as the site reads
// them (PublicSettings.seo): the organisation's name and logo with their defaults, a person by their author page; and a page's
// breadcrumbs, which name its published parents only.
import { ContentItem, MediaItem, PublicSettings, ReadingSettingsResponse, ResolveResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { setSetting } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'
import * as f from './media-fixtures.ts'

noticeIfSkipped('SEO settings')

describe.skipIf(TEST_DATABASE_URL === undefined)('«Deling og søkemotorer» (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let editor: TestClient
  let visitor: TestClient
  let adminId: string

  async function upload(bytes: Uint8Array, name: string): Promise<MediaItem> {
    const form = new FormData()
    form.append('file', new File([bytes.slice().buffer], name))
    const res = await env.app.request('/api/v1/media', {
      method: 'POST',
      body: form,
      headers: {
        origin: TEST_ORIGIN,
        ...(admin.cookie === undefined ? {} : { cookie: admin.cookie }),
        ...(admin.csrfToken === undefined ? {} : { 'x-csrf-token': admin.csrfToken }),
      },
    })
    expect(res.status).toBe(201)
    return MediaItem.parse(await res.json())
  }

  async function publicSettings(): Promise<PublicSettings> {
    return PublicSettings.parse(await (await visitor.get('/api/v1/public/settings')).json())
  }

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'seo-admin', role: 'administrator' })
    await env.createAccount({ username: 'seo-editor', role: 'editor' })
    admin = env.client({ ip: '203.0.113.81' })
    editor = env.client({ ip: '203.0.113.82' })
    visitor = env.client({ ip: '203.0.113.83' })
    expect((await admin.login('seo-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await editor.login('seo-editor', TEST_PASSWORD)).status).toBe(200)
    adminId = (await env.query<{ id: string }>(`select id from account where username = 'seo-admin'`))[0]?.id ?? ''
    await setSetting(env, 'blogname', 'Fjellbloggen')
  })

  afterAll(async () => {
    await env.close()
  })

  it('names the site as the organisation, with the logo from «Tilpass», until it is told otherwise', async () => {
    const logo = await upload(f.PNG, 'logo.png')
    await setSetting(env, 'site_logo', logo.id)
    const seo = (await publicSettings()).seo
    expect(seo.defaultImage).toBeNull()
    expect(seo.publisher).toMatchObject({ type: 'organization', name: 'Fjellbloggen', logo: { id: logo.id } })
    expect((await publicSettings()).origin).toBe(TEST_ORIGIN)
  })

  it('stores a sharing image and an organisation, and refuses what is not an image', async () => {
    const sharing = await upload(f.JPEG, 'deling.jpg')
    const pdf = await upload(f.PDF, 'dokument.pdf')
    const own = await upload(f.PNG, 'eget-logo.png')
    expect(
      (await admin.patch('/api/v1/settings/reading', { seo_default_image: pdf.id })).status,
      'a PDF is no sharing image',
    ).toBe(400)
    expect((await admin.patch('/api/v1/settings/reading', { seo_publisher_logo: crypto.randomUUID() })).status).toBe(400)
    const res = await admin.patch('/api/v1/settings/reading', {
      seo_default_image: sharing.id,
      seo_publisher_name: '  Fjell AS  ',
      seo_publisher_logo: own.id,
    })
    expect(res.status, await res.clone().text()).toBe(200)
    const body = ReadingSettingsResponse.parse(await res.json())
    expect(body.settings).toMatchObject({ seo_publisher_name: 'Fjell AS', seo_default_image: sharing.id })
    expect(body.media.map((ref) => ref.id).sort()).toEqual([sharing.id, own.id].sort())
    const seo = (await publicSettings()).seo
    expect(seo.defaultImage?.id).toBe(sharing.id)
    expect(seo.publisher).toMatchObject({ type: 'organization', name: 'Fjell AS', logo: { id: own.id } })
    expect((await editor.patch('/api/v1/settings/reading', { seo_publisher_name: 'Nei' })).status).toBe(403)
  })

  it('names a person by their author page, only one with something published', async () => {
    expect(
      (await admin.patch('/api/v1/settings/reading', { seo_publisher_type: 'person', seo_publisher_person: adminId })).status,
      'nothing published yet',
    ).toBe(400)
    const post = await admin.post('/api/v1/content', { type: 'post', title: 'Første', status: 'publish' })
    expect(post.status).toBe(201)
    const people = ReadingSettingsResponse.parse(await (await admin.get('/api/v1/settings/reading')).json()).people
    expect(people.map((person) => person.id)).toContain(adminId)
    const res = await admin.patch('/api/v1/settings/reading', { seo_publisher_type: 'person', seo_publisher_person: adminId })
    expect(res.status, await res.clone().text()).toBe(200)
    const nicename =
      (await env.query<{ nicename: string }>(`select nicename from account where id = $1`, [adminId]))[0]?.nicename ?? ''
    expect((await publicSettings()).seo.publisher).toEqual({
      type: 'person',
      name: expect.any(String) as unknown,
      path: `/author/${nicename}/`,
    })
    await admin.patch('/api/v1/settings/reading', { seo_publisher_type: 'organization' })
  })

  it("names a page's published parents for its breadcrumbs, never a draft's title", async () => {
    const create = async (body: Record<string, unknown>) => {
      const res = await admin.post('/api/v1/content', { type: 'page', ...body })
      expect(res.status, await res.clone().text()).toBe(201)
      return ContentItem.parse(await res.json())
    }
    const top = await create({ title: 'Om oss', slug: 'om', status: 'publish' })
    const hidden = await create({ title: 'HEMMELIG UTKAST', slug: 'mellom', status: 'draft', parentId: top.id })
    await create({ title: 'Teamet', slug: 'team', status: 'publish', parentId: hidden.id })
    const res = await visitor.get(`/api/v1/public/resolve?path=${encodeURIComponent('/om/mellom/team/')}`)
    const resolved = ResolveResponse.parse(await res.json())
    if (resolved.kind !== 'page') throw new Error(`not a page: ${resolved.kind}`)
    expect(resolved.content.ancestors).toEqual([{ title: 'Om oss', path: '/om/' }])
    expect(JSON.stringify(resolved)).not.toContain('HEMMELIG UTKAST')
  })
})
