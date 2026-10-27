// Permalinks and redirects (M1.5, K-197, K-207, K-221): each structure gives the post's address and resolves it back, a page wins
// over a post of the same name, a category's address has its parents, the bases can change, and every old address (a structure, a
// base, a slug, a parent) answers 301 to the address now, with no chain and no loop.
import { ContentItem, PublicListResponse, ResolveResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('permalinks')

describe.skipIf(TEST_DATABASE_URL === undefined)('permalinks and redirects (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let visitor: TestClient
  const terms: Record<string, string> = {}
  let post: ContentItem

  async function create(body: Record<string, unknown>): Promise<ContentItem> {
    const res = await admin.post('/api/v1/content', { status: 'publish', ...body })
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json())
  }
  async function resolve(path: string): Promise<ResolveResponse> {
    const res = await visitor.get(`/api/v1/public/resolve?path=${encodeURIComponent(path)}`)
    expect(res.status, await res.clone().text()).toBe(200)
    return ResolveResponse.parse(await res.json())
  }
  async function pathOfPost(id: string): Promise<string> {
    const list = PublicListResponse.parse(await (await visitor.get('/api/v1/public/query?per_page=50')).json())
    const found = list.items.find((item) => item.id === id)
    if (found === undefined) throw new Error('not listed')
    return found.path
  }
  async function structure(body: Record<string, unknown>): Promise<void> {
    const res = await admin.patch('/api/v1/settings/permalinks', body)
    expect(res.status, await res.clone().text()).toBe(200)
  }
  const shown = (answer: ResolveResponse) =>
    answer.kind === 'single' || answer.kind === 'page' ? answer.content.id : answer.kind

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'perma-admin', role: 'administrator' })
    admin = env.client({ ip: '203.0.113.91' })
    visitor = env.client({ ip: '203.0.113.92' })
    expect((await admin.login('perma-admin', TEST_PASSWORD)).status).toBe(200)
    for (const [name, parent] of [
      ['Nyheter', undefined],
      ['Lokalt', 'Nyheter'],
    ] as const) {
      const res = await admin.post('/api/v1/taxonomies/category/terms', {
        name,
        ...(parent === undefined ? {} : { parentId: terms[parent] }),
      })
      terms[name] = ((await res.json()) as { id: string }).id
    }
    post = await create({
      type: 'post',
      title: 'Hei verden',
      slug: 'hei-verden',
      categories: [terms['Lokalt']],
      publishedAt: '2026-10-26T23:30:00.000Z',
    })
  })

  afterAll(async () => {
    await env.close()
  })

  it('gives each structure its address and resolves it back to the post', async () => {
    const cases = [
      ['/%postname%/', '/hei-verden/'],
      ['/%year%/%monthnum%/%day%/%postname%/', '/2026/10/27/hei-verden/'],
      ['/%year%/%monthnum%/%postname%/', '/2026/10/hei-verden/'],
      ['/archives/%post_id%', `/archives/${String(post.shortId)}`],
      ['/%category%/%postname%/', '/nyheter/lokalt/hei-verden/'],
      ['/%author%/%postname%/', '/perma-admin/hei-verden/'],
      ['', `/?p=${String(post.shortId)}`],
    ] as const
    for (const [rules, path] of cases) {
      await structure({ permalink_structure: rules })
      expect(await pathOfPost(post.id), rules).toBe(path)
      expect(shown(await resolve(path)), rules).toBe(post.id)
    }
    await structure({ permalink_structure: '/%postname%/' })
  })

  it('sends a date or category that is wrong for the post to its own address', async () => {
    await structure({ permalink_structure: '/%year%/%monthnum%/%postname%/' })
    expect(await resolve('/2025/01/hei-verden/')).toMatchObject({ kind: 'redirect', location: '/2026/10/hei-verden/' })
    await structure({ permalink_structure: '/%postname%/' })
  })

  it('lets a page win over a post of the same name, as WordPress does', async () => {
    const samePost = await create({ type: 'post', title: 'Samme', slug: 'samme' })
    const samePage = await create({ type: 'page', title: 'Samme', slug: 'samme' })
    expect(shown(await resolve('/samme/'))).toBe(samePage.id)
    expect(samePost.slug).toBe('samme')
  })

  it("puts a category's parents in its address, and sends a short one to the whole", async () => {
    expect(await resolve('/category/nyheter/lokalt/')).toMatchObject({ kind: 'archive', archive: { type: 'category' } })
    expect(await resolve('/category/lokalt/')).toMatchObject({
      kind: 'redirect',
      location: '/category/nyheter/lokalt/',
    })
  })

  it('takes new bases, and sends the old addresses to the new ones', async () => {
    await structure({ category_base: 'emne', tag_base: 'stikkord' })
    expect(await resolve('/emne/nyheter/')).toMatchObject({ kind: 'archive' })
    expect(await resolve('/category/nyheter/')).toMatchObject({ kind: 'redirect', location: '/emne/nyheter/' })
    expect(await resolve('/category/nyheter/lokalt/')).toMatchObject({
      kind: 'redirect',
      location: '/emne/nyheter/lokalt/',
    })
    await structure({ category_base: '', tag_base: '' })
    expect(await resolve('/emne/nyheter/')).toMatchObject({ kind: 'redirect', location: '/category/nyheter/' })
  })

  it('sends the addresses of every earlier structure to the address now', async () => {
    await structure({ permalink_structure: '/%year%/%monthnum%/%day%/%postname%/' })
    expect(await resolve('/hei-verden/')).toMatchObject({ kind: 'redirect', location: '/2026/10/27/hei-verden/' })
    await structure({ permalink_structure: '/archives/%post_id%' })
    const now = `/archives/${String(post.shortId)}`
    expect(await resolve('/hei-verden/')).toMatchObject({ kind: 'redirect', location: now })
    expect(await resolve('/2026/10/27/hei-verden/')).toMatchObject({ kind: 'redirect', location: now })
    await structure({ permalink_structure: '/%postname%/' })
  })

  it('refuses a structure without the post in it, and a base with a slash at the ends', async () => {
    for (const body of [
      { permalink_structure: '/%year%/%monthnum%/' },
      { permalink_structure: '/%postname%/%tag%/' },
      { category_base: '/emne/' },
      { tag_base: 'a b' },
    ]) {
      expect((await admin.patch('/api/v1/settings/permalinks', body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('sends an old slug to the new one, with no chain, and no loop when the slug comes back (K-207)', async () => {
    const item = await create({ type: 'post', title: 'Flytter', slug: 'forste' })
    const rename = async (slug: string) => {
      expect((await admin.patch(`/api/v1/content/${item.id}`, { slug })).status).toBe(200)
    }
    await rename('andre')
    expect(await resolve('/forste/')).toMatchObject({ kind: 'redirect', location: '/andre/' })
    await rename('tredje')
    // Both old addresses go straight to the one now.
    expect(await resolve('/forste/')).toMatchObject({ kind: 'redirect', location: '/tredje/' })
    expect(await resolve('/andre/')).toMatchObject({ kind: 'redirect', location: '/tredje/' })
    await rename('forste')
    expect(shown(await resolve('/forste/'))).toBe(item.id)
    expect(await resolve('/tredje/')).toMatchObject({ kind: 'redirect', location: '/forste/' })
    const rows = await env.query<{ source: string }>(
      `select source from redirect where content_id = $1 order by source`,
      [item.id],
    )
    expect(rows.map((row) => row.source)).toEqual(['/andre/', '/tredje/'])
  })

  it('sends a moved page and the pages below it to their new addresses', async () => {
    const parentA = await create({ type: 'page', title: 'A', slug: 'a' })
    const parentC = await create({ type: 'page', title: 'C', slug: 'c' })
    const child = await create({ type: 'page', title: 'B', slug: 'b', parentId: parentA.id })
    const grandchild = await create({ type: 'page', title: 'D', slug: 'd', parentId: child.id })
    expect((await admin.patch(`/api/v1/content/${child.id}`, { parentId: parentC.id })).status).toBe(200)
    expect(await resolve('/a/b/')).toMatchObject({ kind: 'redirect', location: '/c/b/' })
    expect(await resolve('/a/b/d/')).toMatchObject({ kind: 'redirect', location: '/c/b/d/' })
    expect(shown(await resolve('/c/b/d/'))).toBe(grandchild.id)
  })

  it('never sends a visitor to an unpublished item, or off the site', async () => {
    const item = await create({ type: 'post', title: 'Snart borte', slug: 'snart' })
    expect((await admin.patch(`/api/v1/content/${item.id}`, { slug: 'borte' })).status).toBe(200)
    expect((await admin.patch(`/api/v1/content/${item.id}`, { status: 'draft' })).status).toBe(200)
    expect((await resolve('/snart/')).kind).toBe('404')
    for (const path of ['/.//evil.example', '//evil.example/', '/%2F%2Fevil.example/']) {
      const answer = await resolve(path)
      if (answer.kind === 'redirect') expect(answer.location, path).toMatch(/^\/(?!\/)/)
    }
  })

  it('reaches a page and a post whose titles are not in the Latin alphabet (their slugs are stored encoded)', async () => {
    const page = await create({ type: 'page', title: 'о нас' })
    const article = await create({ type: 'post', title: '日本' })
    expect(page.slug).toMatch(/^%/)
    expect(shown(await resolve(`/${page.slug}/`))).toBe(page.id)
    expect(shown(await resolve(`/${encodeURIComponent(decodeURIComponent(page.slug))}/`))).toBe(page.id)
    expect(await pathOfPost(article.id)).toBe(`/${article.slug}/`)
    expect(shown(await resolve(`/${article.slug}/`))).toBe(article.id)
  })

  it("refuses bases that take each other's addresses, or the site's own", async () => {
    for (const body of [
      { category_base: 'emne', tag_base: 'emne' },
      { category_base: 'emne', tag_base: 'emne/tema' },
      { category_base: 'author' },
      { tag_base: 'page' },
      { permalink_structure: '/category/%postname%/' },
    ]) {
      expect((await admin.patch('/api/v1/settings/permalinks', body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('lets a page through when a base shares its slug and no term matches', async () => {
    const about = await create({ type: 'page', title: 'Info', slug: 'info' })
    const sub = await create({ type: 'page', title: 'Lag', slug: 'lag', parentId: about.id })
    await structure({ category_base: 'info' })
    try {
      expect(shown(await resolve('/info/lag/'))).toBe(sub.id)
    } finally {
      await structure({ category_base: '' })
    }
  })

  it('sends an old address of a later page to «Enkel» with the page as a query', async () => {
    const split = await create({
      type: 'post',
      title: 'Delt',
      slug: 'delt',
      blocks: [
        { id: 'b_split1', type: 'core/paragraph', version: 1, attrs: { content: [] }, children: [] },
        { id: 'b_split2', type: 'core/nextpage', version: 1, attrs: {}, children: [] },
        { id: 'b_split3', type: 'core/paragraph', version: 1, attrs: { content: [] }, children: [] },
      ],
    })
    await structure({ permalink_structure: '' })
    try {
      expect(await resolve('/delt/2/')).toMatchObject({
        kind: 'redirect',
        location: `/?p=${String(split.shortId)}&page=2`,
      })
    } finally {
      await structure({ permalink_structure: '/%postname%/' })
    }
  })
})
