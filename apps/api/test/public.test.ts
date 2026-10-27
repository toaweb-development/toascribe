// The public reading API (M1.4): WordPress' template hierarchy for every kind of address and its fallback to `index`, that nothing
// unpublished or protected leaks through any of its routes, the post password and its cookie (K-067), the signed preview link
// (K-071), and the cache tags a change clears.
import { createBlock } from '@toascribe/blocks'
import type { Block } from '@toascribe/blocks'
import { CacheChanges, ContentItem, PreviewLinkResponse, PublicListResponse, ResolveResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { setSetting } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('public API')

const text = (value: string) => [{ type: 'text', text: value }]
const paragraph = (value: string): Block => createBlock('core/paragraph', { content: text(value) })

/** Words that only unpublished or protected items hold: none may ever be in a public answer. */
const SECRETS = ['KLADDHEMMELIG', 'PRIVATHEMMELIG', 'PLANLAGTHEMMELIG', 'KASTETHEMMELIG', 'PASSORDHEMMELIG']

describe.skipIf(TEST_DATABASE_URL === undefined)('the public API (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let author: TestClient
  let visitor: TestClient
  let nicename: string
  const ids: Record<string, string> = {}
  const shortIds: Record<string, number> = {}
  const terms: Record<string, string> = {}

  async function create(client: TestClient, body: Record<string, unknown>): Promise<ContentItem> {
    const res = await client.post('/api/v1/content', body)
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json())
  }

  async function resolve(path: string, client: TestClient = visitor): Promise<ResolveResponse> {
    const res = await client.get(`/api/v1/public/resolve?path=${encodeURIComponent(path)}`)
    expect(res.status, await res.clone().text()).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    return ResolveResponse.parse(await res.json())
  }

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'pub-admin', role: 'administrator' })
    await env.createAccount({ username: 'pub-author', role: 'author' })
    admin = env.client({ ip: '203.0.113.61' })
    author = env.client({ ip: '203.0.113.62' })
    visitor = env.client({ ip: '203.0.113.63' })
    expect((await admin.login('pub-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await author.login('pub-author', TEST_PASSWORD)).status).toBe(200)
    nicename =
      (await env.query<{ nicename: string }>(`select nicename from account where username = 'pub-author'`))[0]
        ?.nicename ?? ''

    for (const [name, parentId] of [
      ['Nyheter', null],
      ['Lokalt', 'Nyheter'],
    ] as const) {
      const res = await admin.post('/api/v1/taxonomies/category/terms', {
        name,
        ...(parentId === null ? {} : { parentId: terms[parentId] }),
      })
      expect(res.status, await res.clone().text()).toBe(201)
      terms[name] = ((await res.json()) as { id: string }).id
    }

    const hello = await create(author, {
      type: 'post',
      title: 'Hei fjellet',
      slug: 'hei',
      status: 'publish',
      categories: [terms['Lokalt']],
      tags: ['fjell'],
      blocks: [
        paragraph('Innledning om fjellet.'),
        createBlock('core/more', { customText: 'Fortsett å lese' }),
        paragraph('Første side.'),
        createBlock('core/nextpage'),
        paragraph('Andre side.'),
      ],
    })
    ids['hello'] = hello.id
    shortIds['hello'] = hello.shortId
    for (const [key, status, secret, extra] of [
      ['draft', 'draft', 'KLADDHEMMELIG', {}],
      ['private', 'private', 'PRIVATHEMMELIG', {}],
      ['future', 'future', 'PLANLAGTHEMMELIG', { publishedAt: '2099-01-01T00:00:00.000Z' }],
      ['trashed', 'publish', 'KASTETHEMMELIG', {}],
      ['locked', 'publish', 'PASSORDHEMMELIG', { password: 'sesam' }],
    ] as const) {
      const item = await create(author, {
        type: 'post',
        title: key === 'locked' ? 'Låst innlegg' : `Tittel ${secret}`,
        slug: key,
        status,
        ...extra,
        ...(key === 'locked'
          ? { excerpt: `Utdrag ${secret}`, seo: { title: 'Låst', description: `Beskrivelse ${secret}` } }
          : {}),
        blocks: [paragraph(`Teksten ${secret}`)],
      })
      ids[key] = item.id
      shortIds[key] = item.shortId
    }
    expect((await author.post(`/api/v1/content/${ids['trashed'] ?? ''}/trash`)).status).toBe(200)

    const about = await create(admin, { type: 'page', title: 'Om oss', slug: 'om', status: 'publish' })
    ids['about'] = about.id
    const team = await create(admin, {
      type: 'page',
      title: 'Teamet',
      slug: 'team',
      status: 'publish',
      parentId: about.id,
      template: 'full-width',
    })
    ids['team'] = team.id
    ids['blog'] = (await create(admin, { type: 'page', title: 'Blogg', slug: 'blogg', status: 'publish' })).id
  })

  afterAll(async () => {
    await env.close()
  })

  describe('the template hierarchy', () => {
    it('shows the latest posts on the front page, sticky first, with «Les mer» as a teaser', async () => {
      const home = await resolve('/')
      expect(home).toMatchObject({ kind: 'home', status: 200, templates: ['front-page', 'home', 'index'] })
      if (home.kind !== 'home') throw new Error('not home')
      const hello = home.list.items.find((item) => item.id === ids['hello'])
      expect(hello).toMatchObject({ path: '/hei/', moreText: 'Fortsett å lese', excerpt: 'Innledning om fjellet.' })
      expect(hello?.teaser).toHaveLength(1)
      expect(home.cacheTags).toEqual(expect.arrayContaining(['list:post', 'settings']))
    })

    it('resolves a post, its pages after a page break, and nothing past the last', async () => {
      const first = await resolve('/hei/')
      expect(first).toMatchObject({
        kind: 'single',
        templates: ['single-post-hei', 'single-post', 'single', 'singular', 'index'],
      })
      if (first.kind !== 'single') throw new Error('not single')
      expect(first.content).toMatchObject({ page: 1, pages: 2, locked: false })
      expect(first.content.categories.map((term) => term.path)).toEqual(['/category/lokalt/'])
      expect(first.content.tags.map((term) => term.path)).toEqual(['/tag/fjell/'])
      expect(first.cacheTags).toEqual(
        expect.arrayContaining([`content:${ids['hello'] ?? ''}`, `term:${terms['Lokalt'] ?? ''}`, 'settings']),
      )
      expect(await resolve('/hei/2/')).toMatchObject({ kind: 'single', content: { page: 2 } })
      expect(await resolve('/hei/3/')).toMatchObject({ kind: '404', status: 404, templates: ['404', 'index'] })
    })

    it('resolves a page by its whole path, with its chosen template first', async () => {
      expect(await resolve('/om/team/')).toMatchObject({
        kind: 'page',
        templates: ['full-width', 'page-team', 'page', 'singular', 'index'],
        content: { path: '/om/team/', parentId: ids['about'] },
      })
      expect((await resolve('/om/team/')).cacheTags).toContain(`content:${ids['about'] ?? ''}`)
      expect((await resolve('/team/')).kind).toBe('404')
      expect((await resolve('/annen/team/')).kind).toBe('404')
    })

    it('resolves the category (with its children), tag, author and date archives', async () => {
      const parent = await resolve('/category/nyheter/')
      expect(parent).toMatchObject({
        kind: 'archive',
        templates: ['category-nyheter', 'category', 'archive', 'index'],
        archive: { type: 'category', term: { slug: 'nyheter' } },
      })
      if (parent.kind !== 'archive') throw new Error('not an archive')
      expect(parent.list.items.map((item) => item.id)).toContain(ids['hello'])
      expect(await resolve('/tag/fjell/')).toMatchObject({ templates: ['tag-fjell', 'tag', 'archive', 'index'] })
      expect(await resolve(`/author/${nicename}/`)).toMatchObject({
        templates: [`author-${nicename}`, 'author', 'archive', 'index'],
      })
      const year = new Date().getUTCFullYear()
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0')
      const dated = await resolve(`/${String(year)}/${month}/`)
      expect(dated).toMatchObject({ templates: ['date', 'archive', 'index'], archive: { type: 'date', year } })
      if (dated.kind !== 'archive') throw new Error('not an archive')
      expect(dated.list.items.map((item) => item.id)).toContain(ids['hello'])
      expect((await resolve('/1999/01/')).kind).toBe('archive')
      expect((await resolve('/2026/13/')).kind).toBe('404')
      expect((await resolve('/category/finnes-ikke/')).kind).toBe('404')
      expect((await resolve('/author/finnes-ikke/')).kind).toBe('404')
    })

    it('searches, pages archives, redirects `?p=` and an address without its closing slash, and falls back to 404', async () => {
      const search = await resolve('/?s=fjellet')
      expect(search).toMatchObject({
        kind: 'search',
        templates: ['search', 'index'],
        archive: { type: 'search', query: 'fjellet' },
      })
      if (search.kind !== 'search') throw new Error('not a search')
      expect(search.list.items.map((item) => item.id)).toEqual([ids['hello']])
      expect((await resolve('/page/2/')).kind).toBe('404')
      expect(await resolve(`/?p=${String(shortIds['hello'])}`)).toMatchObject({
        kind: 'redirect',
        status: 301,
        location: '/hei/',
      })
      expect(await resolve('/hei')).toMatchObject({ kind: 'redirect', location: '/hei/' })
      expect(await resolve('/finnes-ikke/')).toMatchObject({ kind: '404', templates: ['404', 'index'] })
      expect((await resolve('/%E0%A4%A/')).kind).toBe('404')
    })

    it('shows a static front page and the posts page when the reading settings say so (K-226)', async () => {
      await setSetting(env, 'show_on_front', 'page')
      await setSetting(env, 'page_on_front', ids['about'])
      await setSetting(env, 'page_for_posts', ids['blog'])
      try {
        const front = await resolve('/')
        expect(front).toMatchObject({
          kind: 'front-page',
          templates: ['front-page', 'page-om', 'page', 'singular', 'index'],
        })
        if (front.kind !== 'front-page') throw new Error('not the front page')
        expect(front.content.path).toBe('/')
        expect(await resolve('/blogg/')).toMatchObject({ kind: 'home', templates: ['home', 'index'] })
        expect(await resolve('/om/')).toMatchObject({ kind: 'redirect', location: '/' })
        expect(await resolve('/om/team/')).toMatchObject({ kind: 'page', content: { path: '/om/team/' } })
        const settings = (await (await visitor.get('/api/v1/public/settings')).json()) as Record<string, unknown>
        expect(settings).toMatchObject({ showOnFront: 'page', postsPagePath: '/blogg/' })
      } finally {
        await setSetting(env, 'show_on_front', 'posts')
        await setSetting(env, 'page_on_front', null)
        await setSetting(env, 'page_for_posts', null)
      }
    })
  })

  describe('what is never shown', () => {
    it('leaves a protected item out of a search, so a match tells nothing about its hidden words', async () => {
      for (const word of ['PASSORDHEMMELIG', 'Teksten', 'Utdrag', 'Beskrivelse', 'Låst']) {
        const found = await resolve(`/?s=${word}`)
        if (found.kind !== 'search') throw new Error('not a search')
        expect(
          found.list.items.map((item) => item.id),
          word,
        ).not.toContain(ids['locked'])
        const listed = PublicListResponse.parse(await (await visitor.get(`/api/v1/public/query?search=${word}`)).json())
        expect(
          listed.items.map((item) => item.id),
          word,
        ).not.toContain(ids['locked'])
      }
    })

    it('has an author archive only for an active account with something published', async () => {
      await env.createAccount({ username: 'pub-quiet', role: 'author' })
      const quiet =
        (await env.query<{ nicename: string }>(`select nicename from account where username = 'pub-quiet'`))[0]
          ?.nicename ?? ''
      expect((await resolve(`/author/${quiet}/`)).kind).toBe('404')
    })

    it('redirects to an address on the site only, built from the path it read', async () => {
      expect(await resolve('/.//hei')).toMatchObject({ kind: 'redirect', location: '/hei/' })
      expect(await resolve('/hei/2')).toMatchObject({ kind: 'redirect', location: '/hei/2/' })
    })

    it('marks every public answer no-store, an error included', async () => {
      const bad = await visitor.get('/api/v1/public/resolve')
      expect(bad.status).toBe(400)
      expect(bad.headers.get('cache-control')).toBe('no-store')
      const wrong = await visitor.post('/api/v1/public/unlock', { contentId: ids['locked'], password: 'feil-nr-1' })
      expect(wrong.headers.get('cache-control')).toBe('no-store')
      expect((await visitor.get(`/api/v1/public/cache/changes?since=${'9'.repeat(20)}.1`)).status).toBe(400)
    })

    it('answers 404 for drafts, private, scheduled and trashed items, by path and by `?p=`', async () => {
      for (const key of ['draft', 'private', 'future', 'trashed']) {
        expect((await resolve(`/${key}/`)).kind, key).toBe('404')
        expect((await resolve(`/?p=${String(shortIds[key])}`)).kind, key).toBe('404')
      }
    })

    it('leaks no unpublished or protected text through any route, for a visitor or a signed-in admin', async () => {
      const paths = [
        '/',
        '/hei/',
        '/locked/',
        '/category/nyheter/',
        '/tag/fjell/',
        `/author/${nicename}/`,
        '/?s=HEMMELIG',
        '/?s=Teksten',
        '/?s=Tittel',
        '/?s=Utdrag',
      ]
      for (const client of [visitor, admin]) {
        for (const path of paths) {
          const body = JSON.stringify(await resolve(path, client))
          for (const secret of SECRETS) expect(body, `${path} ${secret}`).not.toContain(secret)
        }
        for (const query of ['', '?search=Teksten', '?type=page', `?author=${nicename}`, '?order=asc&orderby=title']) {
          const body = await (await client.get(`/api/v1/public/query${query}`)).text()
          for (const secret of SECRETS) expect(body, `${query} ${secret}`).not.toContain(secret)
        }
      }
    })
  })

  describe('a password-protected item (K-067)', () => {
    it('shows its title and the form, never its text or excerpt, until its password is given', async () => {
      const locked = await resolve('/locked/')
      if (locked.kind !== 'single') throw new Error('not single')
      expect(locked.content).toMatchObject({ protected: true, locked: true, blocks: [], excerpt: '', teaser: null })
      expect(locked.content.seo).toEqual({ title: 'Låst' })
      const listed = PublicListResponse.parse(await (await visitor.get('/api/v1/public/query')).json())
      expect(listed.items.find((item) => item.id === ids['locked'])).toMatchObject({ locked: true, excerpt: '' })
    })

    it('sets a ten-day HttpOnly cookie for the right password, and refuses the wrong one', async () => {
      const guest = env.client({ ip: '203.0.113.64' })
      const wrong = await guest.post('/api/v1/public/unlock', { contentId: ids['locked'], password: 'feil' })
      expect(wrong.status).toBe(400)
      expect(guest.lastSetCookie).toEqual([])
      const right = await guest.post('/api/v1/public/unlock', { contentId: ids['locked'], password: 'sesam' })
      expect(right.status).toBe(204)
      const line = guest.lastSetCookie.find((cookie) => cookie.startsWith('__Host-toa_postpass='))
      expect(line).toMatch(/HttpOnly/i)
      expect(line).toMatch(/Secure/i)
      expect(line).toMatch(/Max-Age=864000/)
      expect(line).not.toContain('sesam')
      const cookie = (line ?? '').split(';')[0] ?? ''
      const opened = await resolve('/locked/', guest)
      expect(opened.kind === 'single' && opened.content.locked).toBe(true)
      const withCookie = ResolveResponse.parse(
        await (await guest.get(`/api/v1/public/resolve?path=${encodeURIComponent('/locked/')}`, { cookie })).json(),
      )
      if (withCookie.kind !== 'single') throw new Error('not single')
      expect(withCookie.content.locked).toBe(false)
      expect(JSON.stringify(withCookie.content.blocks)).toContain('PASSORDHEMMELIG')
      // A cookie that is not the item's opens nothing.
      const forged = await guest.get(`/api/v1/public/resolve?path=${encodeURIComponent('/locked/')}`, {
        cookie: `__Host-toa_postpass=${'A'.repeat(43)}`,
      })
      expect(JSON.stringify(await forged.json())).not.toContain('PASSORDHEMMELIG')
    })

    it('opens nothing for an item that is not published, and limits guesses per item', async () => {
      expect((await visitor.post('/api/v1/public/unlock', { contentId: ids['draft'], password: 'x' })).status).toBe(400)
      let status = 0
      for (let attempt = 0; attempt < 8 && status !== 429; attempt += 1) {
        const guesser = env.client({ ip: `198.18.0.${String(attempt + 1)}` })
        status = (
          await guesser.post('/api/v1/public/unlock', { contentId: ids['locked'], password: `gjett${String(attempt)}` })
        ).status
      }
      expect(status).toBe(429)
    })
  })

  describe('the preview link (K-071)', () => {
    async function link(client: TestClient, id: string): Promise<string> {
      const res = await client.post(`/api/v1/content/${id}/preview-link`)
      expect(res.status, await res.clone().text()).toBe(200)
      const { path } = PreviewLinkResponse.parse(await res.json())
      return new URL(path, 'http://site.invalid').searchParams.get('preview') ?? ''
    }
    const preview = (token: string) => visitor.get(`/api/v1/public/preview?token=${encodeURIComponent(token)}`)

    it('shows a draft to whoever has the link, as stored, and only that item', async () => {
      const token = await link(author, ids['draft'] ?? '')
      const res = await preview(token)
      expect(res.status).toBe(200)
      const body = ResolveResponse.parse(await res.json())
      expect(body).toMatchObject({ kind: 'single', cacheTags: [] })
      expect(JSON.stringify(body)).toContain('KLADDHEMMELIG')
      // Another item's id under the same signature is no link.
      const [version, payload, signature] = token.split('.')
      const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<string, unknown>
      const swapped = Buffer.from(JSON.stringify({ ...claims, c: ids['private'] })).toString('base64url')
      expect((await preview(`${version ?? ''}.${swapped}.${signature ?? ''}`)).status).toBe(404)
      expect((await preview(`${token}x`)).status).toBe(404)
    })

    it('stops working when it expires, and after the session that made it logs out', async () => {
      const expiring = await link(author, ids['draft'] ?? '')
      env.clock.advance(31 * 60 * 1000)
      try {
        expect((await preview(expiring)).status).toBe(404)
      } finally {
        env.clock.advance(-31 * 60 * 1000)
      }
      const leaving = env.client({ ip: '203.0.113.65' })
      expect((await leaving.login('pub-author', TEST_PASSWORD)).status).toBe(200)
      const token = await link(leaving, ids['draft'] ?? '')
      expect((await preview(token)).status).toBe(200)
      expect((await leaving.post('/api/v1/auth/logout')).status).toBe(204)
      expect((await preview(token)).status).toBe(404)
    })

    it('is not made for an item the account may not edit', async () => {
      const other = await create(admin, { type: 'post', title: 'Admins kladd', status: 'draft' })
      expect((await author.post(`/api/v1/content/${other.id}/preview-link`)).status).toBe(404)
      expect((await author.post(`/api/v1/content/${ids['trashed'] ?? ''}/preview-link`)).status).toBe(404)
    })
  })

  describe('the cache changes', () => {
    async function changes(since?: string): Promise<CacheChanges> {
      const query = since === undefined ? '' : `?since=${since}`
      return CacheChanges.parse(await (await visitor.get(`/api/v1/public/cache/changes${query}`)).json())
    }

    it('says everything changed on the first look, then names the tags of each change', async () => {
      const first = await changes()
      expect(first.all).toBe(true)
      expect(await changes(first.cursor)).toMatchObject({ all: false, tags: [] })
      expect((await author.patch(`/api/v1/content/${ids['hello'] ?? ''}`, { title: 'Hei igjen' })).status).toBe(200)
      const next = await changes(first.cursor)
      expect(next.all).toBe(false)
      expect(next.tags).toEqual(expect.arrayContaining([`content:${ids['hello'] ?? ''}`, 'list:post']))
      const res = await admin.patch(`/api/v1/taxonomies/category/terms/${terms['Lokalt'] ?? ''}`, {
        name: 'Lokalt nytt',
      })
      expect(res.status).toBe(200)
      expect((await changes(next.cursor)).tags).toEqual(expect.arrayContaining([`term:${terms['Lokalt'] ?? ''}`]))
    })

    it('sees a change whose transaction began before the look and committed after it', async () => {
      const client = await env.pool.connect()
      try {
        await client.query('begin')
        await client.query(`insert into cache_invalidation (tag) values ('content:sen')`)
        const looked = await changes((await changes()).cursor)
        expect(looked.tags).not.toContain('content:sen')
        await client.query('commit')
        expect((await changes(looked.cursor)).tags).toContain('content:sen')
      } finally {
        client.release()
      }
    })

    it('says everything changed after a settings change, or when the last look is too old', async () => {
      const start = await changes()
      expect((await admin.patch('/api/v1/settings/media', { thumbnail_size_w: 160 })).status).toBe(200)
      expect((await changes(start.cursor)).all).toBe(true)
      const old = `${start.cursor.split('.')[0] ?? ''}.${String(Date.now() - 2 * 24 * 60 * 60 * 1000)}`
      expect((await changes(old)).all).toBe(true)
    })
  })
})
