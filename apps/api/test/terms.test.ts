// Categories and tags (M1.2): the hierarchy, slugs with Norwegian letters, the default category that cannot be deleted, deletion that
// moves posts and child categories, and terms on posts through the content API (with the list filters).
import { ContentItem, ContentListResponse, TermItem, TermListResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('terms')

describe.skipIf(TEST_DATABASE_URL === undefined)('categories and tags (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let editor: TestClient
  let author: TestClient
  let uncategorized: string

  const CATEGORIES = '/api/v1/taxonomies/category/terms'
  const TAGS = '/api/v1/taxonomies/post_tag/terms'

  beforeAll(async () => {
    env = await startAuthApp()
    for (const [name, role] of [
      ['t-editor', 'editor'],
      ['t-author', 'author'],
    ] as const) {
      await env.createAccount({ username: name, role })
    }
    editor = env.client()
    expect((await editor.login('t-editor', TEST_PASSWORD)).status).toBe(200)
    author = env.client({ ip: '203.0.113.8' })
    expect((await author.login('t-author', TEST_PASSWORD)).status).toBe(200)
    // The install makes «Ukategorisert» and sets it as the default category; the test database is not installed.
    const [row] = await env.query<{ id: string }>(
      `insert into term (taxonomy_id, slug, name) select id, 'ukategorisert', 'Ukategorisert' from taxonomy where slug = 'category'
       returning id`,
    )
    uncategorized = row?.id ?? ''
    await env.query(`update setting set value = to_jsonb($1::text) where key = 'default_category'`, [uncategorized])
  })

  afterAll(async () => {
    await env.close()
  })

  async function makeTerm(path: string, body: Record<string, unknown>): Promise<TermItem> {
    const res = await editor.post(path, body)
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201)
    return TermItem.parse(await res.json())
  }

  async function code(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code
  }

  it('makes categories with a hierarchy and slugs from Norwegian names, and lists them as a tree', async () => {
    const parent = await makeTerm(CATEGORIES, { name: 'Friluftsliv på Østlandet' })
    expect(parent.slug).toBe('friluftsliv-pa-ostlandet')
    const child = await makeTerm(CATEGORIES, { name: 'Skiturer', parentId: parent.id, description: 'Om vinteren' })
    // A second «Skiturer» elsewhere: WordPress tries «<slug>-<parent slug>» before a number.
    const other = await makeTerm(CATEGORIES, { name: 'Sommer' })
    const second = await makeTerm(CATEGORIES, { name: 'Skiturer', parentId: other.id })
    expect([child.slug, second.slug]).toEqual(['skiturer', 'skiturer-sommer'])
    // The same name under the same parent is refused.
    const twice = await editor.post(CATEGORIES, { name: 'skiturer', parentId: parent.id })
    expect([twice.status, await code(twice)]).toEqual([409, 'term_exists'])

    const list = TermListResponse.parse(await (await editor.get(`${CATEGORIES}?per_page=100`)).json())
    const order = list.items.map((item) => [item.name, item.depth])
    const at = order.findIndex(([name]) => name === 'Friluftsliv på Østlandet')
    expect(order[at + 1]).toEqual(['Skiturer', 1])
    expect(list.items.find((item) => item.id === uncategorized)?.isDefault).toBe(true)
  })

  it('refuses a category under itself or under one of its children, and a parent for a tag', async () => {
    const top = await makeTerm(CATEGORIES, { name: 'Topp' })
    const below = await makeTerm(CATEGORIES, { name: 'Under', parentId: top.id })
    expect(await code(await editor.patch(`${CATEGORIES}/${top.id}`, { parentId: below.id }))).toBe('invalid_parent')
    expect(await code(await editor.post(TAGS, { name: 'Flat', parentId: top.id }))).toBe('invalid_parent')
  })

  it('renames the default category but never deletes it', async () => {
    const renamed = await editor.patch(`${CATEGORIES}/${uncategorized}`, { name: 'Diverse' })
    expect(TermItem.parse(await renamed.json()).name).toBe('Diverse')
    const refused = await editor.delete(`${CATEGORIES}/${uncategorized}`)
    expect([refused.status, await code(refused)]).toEqual([409, 'default_term'])
    const bulk = await editor.post(`${CATEGORIES}/bulk`, { action: 'delete', ids: [uncategorized] })
    expect(await bulk.json()).toEqual({ changed: [], skipped: [{ id: uncategorized, reason: 'default_term' }] })
  })

  it('gives a post without categories the default one, and takes categories and tags by id and by name', async () => {
    const plain = ContentItem.parse(
      await (await author.post('/api/v1/content', { type: 'post', title: 'Uten' })).json(),
    )
    expect(plain.categories.map((term) => term.id)).toEqual([uncategorized])
    const food = await makeTerm(CATEGORIES, { name: 'Mat' })
    const made = await author.post('/api/v1/content', {
      type: 'post',
      title: 'Med termer',
      categories: [food.id],
      tags: ['Blåbær', 'sommer', 'blåbær'],
    })
    const item = ContentItem.parse(await made.json())
    expect(item.categories.map((term) => term.name)).toEqual(['Mat'])
    expect(item.tags.map((term) => [term.name, term.slug])).toEqual([
      ['Blåbær', 'blabaer'],
      ['sommer', 'sommer'],
    ])
    // An author may assign tags by name (they become tags) but not make categories.
    expect((await author.post(CATEGORIES, { name: 'Nei' })).status).toBe(403)
    // Pages have no terms.
    const page = await editor.post('/api/v1/content', { type: 'page', title: 'Side', tags: ['x'] })
    expect([page.status, await code(page)]).toEqual([400, 'terms_not_supported'])
    // A category that does not exist.
    const wrong = await author.patch(`/api/v1/content/${item.id}`, { categories: [crypto.randomUUID()] })
    expect(await code(wrong)).toBe('invalid_term')
  })

  it('filters the post list by a category (with the ones below it) and by a tag', async () => {
    const parent = await makeTerm(CATEGORIES, { name: 'Reiser' })
    const child = await makeTerm(CATEGORIES, { name: 'Norge', parentId: parent.id })
    const inChild = ContentItem.parse(
      await (
        await editor.post('/api/v1/content', {
          type: 'post',
          title: 'Lofoten',
          categories: [child.id],
          tags: ['Fjell'],
        })
      ).json(),
    )
    const elsewhere = ContentItem.parse(
      await (await editor.post('/api/v1/content', { type: 'post', title: 'Annet' })).json(),
    )
    const byCategory = ContentListResponse.parse(
      await (await editor.get(`/api/v1/content?type=post&category=${parent.id}&per_page=100`)).json(),
    )
    expect(byCategory.items.map((entry) => entry.id)).toEqual([inChild.id])
    const tag = inChild.tags[0]?.id ?? ''
    const byTag = ContentListResponse.parse(await (await editor.get(`/api/v1/content?type=post&tag=${tag}`)).json())
    expect(byTag.items.map((entry) => entry.id)).toEqual([inChild.id])
    expect(byTag.items.map((entry) => entry.id)).not.toContain(elsewhere.id)
  })

  it('moves the posts of a deleted category to its parent, or to the default, and its children up', async () => {
    const parent = await makeTerm(CATEGORIES, { name: 'Forelder' })
    const middle = await makeTerm(CATEGORIES, { name: 'Midten', parentId: parent.id })
    const grandchild = await makeTerm(CATEGORIES, { name: 'Barnebarn', parentId: middle.id })
    const lonely = await makeTerm(CATEGORIES, { name: 'Alene' })
    const inMiddle = ContentItem.parse(
      await (await editor.post('/api/v1/content', { type: 'post', title: 'I midten', categories: [middle.id] })).json(),
    )
    const inLonely = ContentItem.parse(
      await (await editor.post('/api/v1/content', { type: 'post', title: 'Alene', categories: [lonely.id] })).json(),
    )
    expect((await editor.delete(`${CATEGORIES}/${middle.id}`)).status).toBe(204)
    expect((await editor.delete(`${CATEGORIES}/${lonely.id}`)).status).toBe(204)
    const moved = ContentItem.parse(await (await editor.get(`/api/v1/content/${inMiddle.id}`)).json())
    expect(moved.categories.map((term) => term.id)).toEqual([parent.id])
    const fallback = ContentItem.parse(await (await editor.get(`/api/v1/content/${inLonely.id}`)).json())
    expect(fallback.categories.map((term) => term.id)).toEqual([uncategorized])
    const child = TermItem.parse(await (await editor.get(`${CATEGORIES}/${grandchild.id}`)).json())
    expect(child.parentId).toBe(parent.id)
  })

  it('adds categories and tags in a bulk edit without taking away the ones a post has', async () => {
    const one = await makeTerm(CATEGORIES, { name: 'En' })
    const two = await makeTerm(CATEGORIES, { name: 'To' })
    const post = ContentItem.parse(
      await (
        await editor.post('/api/v1/content', { type: 'post', title: 'Masse', categories: [one.id], tags: ['a'] })
      ).json(),
    )
    const res = await editor.post('/api/v1/content/bulk', {
      action: 'edit',
      ids: [post.id],
      changes: { addCategories: [two.id], addTags: ['b'] },
    })
    expect(((await res.json()) as { changed: string[] }).changed).toEqual([post.id])
    const after = ContentItem.parse(await (await editor.get(`/api/v1/content/${post.id}`)).json())
    expect(after.categories.map((term) => term.name)).toEqual(['En', 'To'])
    expect(after.tags.map((term) => term.name)).toEqual(['a', 'b'])
  })

  it('counts the published posts of a term', async () => {
    const counted = await makeTerm(TAGS, { name: 'Telles' })
    await editor.post('/api/v1/content', { type: 'post', title: 'Publisert', status: 'publish', tags: ['Telles'] })
    await editor.post('/api/v1/content', { type: 'post', title: 'Kladd', tags: ['Telles'] })
    const item = TermItem.parse(await (await editor.get(`${TAGS}/${counted.id}`)).json())
    expect(item.count).toBe(1)
  })
})
