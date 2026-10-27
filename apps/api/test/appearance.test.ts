// Menus and global sets (M1.5, K-132, K-106): a menu of three levels in its order and location, an item that follows its content and
// leaves with it, the public menu that never links unpublished content, and a global set checked as content is and read by the site.
import { createBlock } from '@toascribe/blocks'
import { ContentItem, MenuDetail, PublicGlobalSetResponse, PublicMenuResponse } from '@toascribe/shared'
import type { MenuItem, PublicMenuItem } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('menus and global sets')

let serial = 0
const item = (fields: Partial<MenuItem> & Pick<MenuItem, 'kind'>, children: MenuItem[] = []): MenuItem => ({
  id: `m_item${String((serial += 1))}`,
  label: '',
  newTab: false,
  cssClass: '',
  description: '',
  ...fields,
  children,
})
const labels = (items: readonly PublicMenuItem[]): unknown[] =>
  items.map((entry) => (entry.children.length === 0 ? entry.label : [entry.label, labels(entry.children)]))

describe.skipIf(TEST_DATABASE_URL === undefined)('menus and global sets (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let editor: TestClient
  let visitor: TestClient
  const ids: Record<string, string> = {}

  async function create(body: Record<string, unknown>): Promise<ContentItem> {
    const res = await admin.post('/api/v1/content', { status: 'publish', ...body })
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json())
  }
  const publicMenu = async (location: string) =>
    PublicMenuResponse.parse(await (await visitor.get(`/api/v1/public/menus/${location}`)).json())

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'menu-admin', role: 'administrator' })
    await env.createAccount({ username: 'menu-editor', role: 'editor' })
    admin = env.client({ ip: '203.0.113.101' })
    editor = env.client({ ip: '203.0.113.102' })
    visitor = env.client({ ip: '203.0.113.103' })
    expect((await admin.login('menu-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await editor.login('menu-editor', TEST_PASSWORD)).status).toBe(200)
    ids['about'] = (await create({ type: 'page', title: 'Om oss', slug: 'om' })).id
    ids['team'] = (await create({ type: 'page', title: 'Teamet', slug: 'team', parentId: ids['about'] })).id
    ids['post'] = (await create({ type: 'post', title: 'Nyhet', slug: 'nyhet' })).id
    ids['draft'] = (await create({ type: 'page', title: 'Hemmelig kladd', slug: 'kladd', status: 'draft' })).id
    const category = await admin.post('/api/v1/taxonomies/category/terms', { name: 'Turer' })
    ids['category'] = ((await category.json()) as { id: string }).id
  })

  afterAll(async () => {
    await env.close()
  })

  describe('menus (K-132)', () => {
    let menu: MenuDetail

    it('keeps three levels in their order, in the location it is placed in', async () => {
      const res = await admin.post('/api/v1/menus', { name: 'Hovedmeny' })
      expect(res.status).toBe(201)
      menu = MenuDetail.parse(await res.json())
      const items = [
        item({ kind: 'page', objectId: ids['about'] }, [
          item({ kind: 'page', objectId: ids['team'], label: 'Folka' }, [
            item({ kind: 'custom', url: 'https://example.no/', label: 'Ekstern', newTab: true }),
          ]),
        ]),
        item({ kind: 'post', objectId: ids['post'], cssClass: 'nyhet viktig', description: 'Siste nytt' }),
        item({ kind: 'category', objectId: ids['category'] }),
        item({ kind: 'page', objectId: ids['draft'] }, [item({ kind: 'custom', url: '/kontakt/', label: 'Kontakt' })]),
      ]
      const saved = await admin.patch(`/api/v1/menus/${menu.id}`, { items })
      expect(saved.status, await saved.clone().text()).toBe(200)
      expect(
        MenuDetail.parse(await saved.json()).views.find((view) => view.objectTitle === 'Hemmelig kladd')?.shown,
      ).toBe(false)
      expect((await admin.put('/api/v1/menu-locations', { locations: { primary: menu.id } })).status).toBe(200)

      const shown = await publicMenu('primary')
      expect(labels(shown.items)).toEqual([['Om oss', [['Folka', ['Ekstern']]]], 'Nyhet', 'Turer', 'Kontakt'])
      expect(shown.items[0]?.url).toBe('/om/')
      expect(shown.items[0]?.children[0]?.url).toBe('/om/team/')
      expect(shown.items[0]?.children[0]?.children[0]).toMatchObject({ url: 'https://example.no/', newTab: true })
      expect(shown.items[1]).toMatchObject({ url: '/nyhet/', cssClass: 'nyhet viktig', description: 'Siste nytt' })
      expect(shown.items[2]?.url).toBe('/category/turer/')
      expect(JSON.stringify(shown)).not.toContain('Hemmelig kladd')
      expect(JSON.stringify(shown)).not.toContain('/kladd/')
      expect((await publicMenu('footer')).items).toEqual([])
    })

    it('follows its content when the title or slug changes, and leaves when the content is deleted for good', async () => {
      expect(
        (await admin.patch(`/api/v1/content/${ids['post'] ?? ''}`, { title: 'Nyheter', slug: 'nytt' })).status,
      ).toBe(200)
      expect((await publicMenu('primary')).items[1]).toMatchObject({ label: 'Nyheter', url: '/nytt/' })
      expect((await admin.post(`/api/v1/content/${ids['post'] ?? ''}/trash`)).status).toBe(200)
      expect(labels((await publicMenu('primary')).items)).not.toContain('Nyheter')
      expect((await admin.delete(`/api/v1/content/${ids['post'] ?? ''}`)).status).toBe(204)
      const stored = MenuDetail.parse(await (await admin.get(`/api/v1/menus/${menu.id}`)).json())
      expect(stored.items.map((entry) => entry.objectId)).not.toContain(ids['post'])
    })

    it('refuses an address a link may not have, and content that does not exist', async () => {
      for (const bad of [
        item({ kind: 'custom', url: 'javascript:alert(1)' }),
        item({ kind: 'custom', url: '//evil.example/' }),
        item({ kind: 'page', objectId: crypto.randomUUID() }),
        item({ kind: 'post', objectId: ids['about'] }),
      ]) {
        const res = await admin.patch(`/api/v1/menus/${menu.id}`, { items: [bad] })
        expect(res.status, JSON.stringify(bad)).toBe(400)
      }
      expect((await admin.patch(`/api/v1/menus/${menu.id}`, { items: [{ kind: 'custom' }] })).status).toBe(400)
    })

    it('is edit_theme_options only, and a deleted menu leaves its location empty', async () => {
      expect((await editor.get('/api/v1/menus')).status).toBe(403)
      expect((await admin.delete(`/api/v1/menus/${menu.id}`)).status).toBe(204)
      expect((await publicMenu('primary')).items).toEqual([])
      const locations = (await (await admin.get('/api/v1/menu-locations')).json()) as {
        locations: Record<string, unknown>
      }
      expect(locations.locations['primary']).toBeNull()
    })
  })

  describe('global sets (K-106)', () => {
    it('stores blocks checked as content is, and gives the site the set by its slug', async () => {
      const res = await admin.post('/api/v1/global-sets', { name: 'Kontaktinfo' })
      expect(res.status).toBe(201)
      const set = (await res.json()) as { id: string; slug: string }
      expect(set.slug).toBe('kontaktinfo')
      const paragraph = createBlock('core/paragraph', { content: [{ type: 'text', text: 'Ring oss' }] })
      expect((await admin.patch(`/api/v1/global-sets/${set.id}`, { blocks: [paragraph] })).status).toBe(200)
      const shown = PublicGlobalSetResponse.parse(
        await (await visitor.get('/api/v1/public/global-sets/kontaktinfo')).json(),
      )
      expect(JSON.stringify(shown.blocks)).toContain('Ring oss')
      expect(shown.cacheTags).toContain(`global_set:${set.id}`)
      expect((await visitor.get('/api/v1/public/global-sets/finnes-ikke')).status).toBe(404)

      // A «Les mer» belongs in a post; a custom HTML block needs unfiltered_html.
      expect((await admin.patch(`/api/v1/global-sets/${set.id}`, { blocks: [createBlock('core/more')] })).status).toBe(
        400,
      )
      expect((await admin.post('/api/v1/global-sets', { name: 'Kontaktinfo', slug: 'kontaktinfo' })).status).toBe(409)
      expect((await editor.post('/api/v1/global-sets', { name: 'Nei' })).status).toBe(403)
    })
  })
})
