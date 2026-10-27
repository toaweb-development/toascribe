// RSS and the sitemap as the api gives them to the site (M1.6, K-222, K-223): the feed of the site and of a category (with its
// parents), a tag, an author; the text or the excerpt; nothing from a draft, a private, scheduled or trashed post, and a protected
// post's title and link only; the sitemap's parts, the split at 2000 addresses, and what it leaves out; 404 with «noindex» on.
import { createBlock } from '@toascribe/blocks'
import type { Block } from '@toascribe/blocks'
import {
  ContentItem,
  PublicFeedResponse,
  PublicSitemapIndex,
  PublicSitemapPage,
  SITEMAP_MAX_URLS,
} from '@toascribe/shared'
import type { PublicFeed } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { setSetting } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN } from './helpers.ts'

noticeIfSkipped('feeds and sitemap')

const text = (value: string) => [{ type: 'text', text: value }]
const paragraph = (value: string): Block => createBlock('core/paragraph', { content: text(value) })

/** Words only unpublished, protected or noindex items hold. */
const SECRETS = ['KLADDHEMMELIG', 'PRIVATHEMMELIG', 'PLANLAGTHEMMELIG', 'KASTETHEMMELIG', 'PASSORDHEMMELIG']

describe.skipIf(TEST_DATABASE_URL === undefined)('feeds and the sitemap (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let visitor: TestClient
  let nicename: string
  const ids: Record<string, string> = {}
  const terms: Record<string, string> = {}

  async function create(body: Record<string, unknown>): Promise<ContentItem> {
    const res = await admin.post('/api/v1/content', body)
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json())
  }

  async function feed(path: string): Promise<PublicFeed> {
    const res = await visitor.get(`/api/v1/public/feed?path=${encodeURIComponent(path)}`)
    expect(res.status, await res.clone().text()).toBe(200)
    const answer = PublicFeedResponse.parse(await res.json())
    if (answer.kind !== 'feed') throw new Error(`not a feed: ${JSON.stringify(answer)}`)
    return answer
  }

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'feed-admin', role: 'administrator' })
    admin = env.client({ ip: '203.0.113.71' })
    visitor = env.client({ ip: '203.0.113.72' })
    expect((await admin.login('feed-admin', TEST_PASSWORD)).status).toBe(200)
    nicename =
      (await env.query<{ nicename: string }>(`select nicename from account where username = 'feed-admin'`))[0]
        ?.nicename ?? ''
    await setSetting(env, 'blogname', 'Fjellbloggen')

    for (const [name, parent] of [
      ['Nyheter', null],
      ['Lokalt', 'Nyheter'],
      ['Tom', null],
    ] as const) {
      const res = await admin.post('/api/v1/taxonomies/category/terms', {
        name,
        ...(parent === null ? {} : { parentId: terms[parent] }),
      })
      expect(res.status).toBe(201)
      terms[name] = ((await res.json()) as { id: string }).id
    }

    ids['hello'] = (
      await create({
        type: 'post',
        title: 'Hei & «fjellet» <b>',
        slug: 'hei',
        status: 'publish',
        categories: [terms['Lokalt']],
        tags: ['fjell'],
        blocks: [
          paragraph('Innledning om fjellet.'),
          createBlock('core/more', { customText: 'Fortsett' }),
          paragraph('Første side.'),
          createBlock('core/nextpage'),
          paragraph('Andre side.'),
        ],
      })
    ).id
    for (const [key, status, secret, extra] of [
      ['draft', 'draft', 'KLADDHEMMELIG', {}],
      ['private', 'private', 'PRIVATHEMMELIG', {}],
      ['future', 'future', 'PLANLAGTHEMMELIG', { publishedAt: '2099-01-01T00:00:00.000Z' }],
      ['trashed', 'publish', 'KASTETHEMMELIG', {}],
      ['locked', 'publish', 'PASSORDHEMMELIG', { password: 'sesam', excerpt: 'Utdrag PASSORDHEMMELIG' }],
    ] as const) {
      ids[key] = (
        await create({
          type: 'post',
          title: key === 'locked' ? 'Låst innlegg' : `Tittel ${secret}`,
          slug: key,
          status,
          categories: [terms['Lokalt']],
          tags: ['fjell'],
          ...extra,
          blocks: [paragraph(`Teksten ${secret}`)],
        })
      ).id
    }
    expect((await admin.post(`/api/v1/content/${ids['trashed'] ?? ''}/trash`)).status).toBe(200)
    ids['hidden'] = (
      await create({
        type: 'post',
        title: 'Ikke indekser',
        slug: 'skjult',
        status: 'publish',
        seo: { noindex: true },
        blocks: [paragraph('Synlig, men ikke i kartet.')],
      })
    ).id
    ids['about'] = (await create({ type: 'page', title: 'Om oss', slug: 'om', status: 'publish' })).id
  })

  afterAll(async () => {
    await env.close()
  })

  describe('RSS (K-222)', () => {
    it("gives the site's feed with the whole text, every page, and absolute addresses", async () => {
      const site = await feed('/')
      expect(site.channel).toMatchObject({
        title: 'Fjellbloggen',
        link: `${TEST_ORIGIN}/`,
        self: `${TEST_ORIGIN}/feed/`,
      })
      expect(site.useExcerpt).toBe(false)
      const hello = site.items.find((item) => item.link === `${TEST_ORIGIN}/hei/`)
      expect(hello?.title).toBe('Hei & «fjellet» <b>')
      expect(hello?.guid).toMatch(/\/\?p=\d+$/)
      expect(hello?.categories).toEqual(['Lokalt', 'fjell'])
      // Both pages, without the «Les mer» and page-break markers.
      expect(hello?.blocks?.map((block) => block['type'])).toEqual([
        'core/paragraph',
        'core/paragraph',
        'core/paragraph',
      ])
      expect(site.cacheTags).toEqual(expect.arrayContaining(['list:post', 'settings', `content:${ids['hello'] ?? ''}`]))
    })

    it('never carries an unpublished post, and a protected one with its title and link only', async () => {
      const site = await feed('/')
      const json = JSON.stringify(site)
      for (const secret of SECRETS) expect(json).not.toContain(secret)
      const locked = site.items.find((item) => item.title === 'Låst innlegg')
      expect(locked).toMatchObject({ excerpt: '', blocks: null, media: [] })
      // Pages are not in a feed.
      expect(site.items.some((item) => item.title === 'Om oss')).toBe(false)
    })

    it('gives the excerpt only when «Lesing» says so, and as many items as it says', async () => {
      await setSetting(env, 'rss_use_excerpt', true)
      await setSetting(env, 'posts_per_rss', 1)
      try {
        const site = await feed('/')
        expect(site.useExcerpt).toBe(true)
        expect(site.items).toHaveLength(1)
        expect(site.items.every((item) => item.blocks === null)).toBe(true)
      } finally {
        await setSetting(env, 'rss_use_excerpt', false)
        await setSetting(env, 'posts_per_rss', 10)
      }
      const hello = (await feed('/')).items.find((item) => item.title.startsWith('Hei'))
      expect(hello?.excerpt).toBe('Innledning om fjellet.')
    })

    it("gives a category's feed under its address with its parents, a tag's and an author's", async () => {
      const local = await feed('/category/nyheter/lokalt/')
      expect(local.channel).toMatchObject({
        title: 'Fjellbloggen » Lokalt',
        link: `${TEST_ORIGIN}/category/nyheter/lokalt/`,
        self: `${TEST_ORIGIN}/category/nyheter/lokalt/feed/`,
      })
      expect(local.items.map((item) => item.title)).toContain('Hei & «fjellet» <b>')
      // The parent's feed has its children's posts too, as its archive does.
      expect((await feed('/category/nyheter/')).items.length).toBeGreaterThan(0)
      expect((await feed('/tag/fjell/')).channel.title).toBe('Fjellbloggen » fjell')
      const byAuthor = await feed(`/author/${nicename}/`)
      expect(byAuthor.channel.link).toBe(`${TEST_ORIGIN}/author/${nicename}/`)
      expect(byAuthor.items.length).toBeGreaterThan(0)
      for (const answer of [local, byAuthor]) {
        const json = JSON.stringify(answer)
        for (const secret of SECRETS) expect(json).not.toContain(secret)
      }
    })

    it('sends a wrong category chain to the right feed, and has no feed for a post, a page or nothing', async () => {
      const moved = await visitor.get(`/api/v1/public/feed?path=${encodeURIComponent('/category/lokalt/')}`)
      expect(moved.status).toBe(200)
      expect(PublicFeedResponse.parse(await moved.json())).toMatchObject({
        kind: 'redirect',
        location: '/category/nyheter/lokalt/feed/',
      })
      // An old post address and `/?p=` lead to an item, which has no feed.
      const renamed = await create({ type: 'post', title: 'Flyttet', slug: 'gammel-adresse', status: 'publish' })
      expect((await admin.patch(`/api/v1/content/${renamed.id}`, { slug: 'ny-adresse' })).status).toBe(200)
      try {
        for (const path of ['/gammel-adresse/', `/?p=${String(renamed.shortId)}`]) {
          const res = await visitor.get(`/api/v1/public/feed?path=${encodeURIComponent(path)}`)
          expect(res.status, path).toBe(404)
        }
      } finally {
        await env.query(`delete from content where id = $1`, [renamed.id])
      }
      for (const path of ['/hei/', '/om/', '/finnes-ikke/', '/category/nyheter/page/2/', '/?s=fjell']) {
        const res = await visitor.get(`/api/v1/public/feed?path=${encodeURIComponent(path)}`)
        expect(res.status, path).toBe(404)
      }
    })
  })

  describe('the sitemap (K-223)', () => {
    it('lists the parts with addresses, and leaves out protected, noindex, unpublished items and empty terms', async () => {
      const index = PublicSitemapIndex.parse(await (await visitor.get('/api/v1/public/sitemap')).json())
      expect(index.sitemaps.map((entry) => `${entry.kind}-${String(entry.page)}`)).toEqual([
        'posts-1',
        'pages-1',
        'categories-1',
        'tags-1',
        'authors-1',
      ])
      expect(index.sitemaps[0]?.loc).toBe(`${TEST_ORIGIN}/sitemap-posts-1.xml`)

      const page = async (kind: string) =>
        PublicSitemapPage.parse(await (await visitor.get(`/api/v1/public/sitemap/${kind}/1`)).json()).urls.map((url) =>
          url.loc.replace(TEST_ORIGIN, ''),
        )
      expect(await page('posts')).toEqual(['/hei/'])
      expect(await page('pages')).toEqual(['/', '/om/'])
      // «Nyheter» has no post of its own (only its child has), and «Tom» none: WordPress leaves both out.
      expect(await page('categories')).toEqual(['/category/nyheter/lokalt/'])
      expect(await page('tags')).toEqual(['/tag/fjell/'])
      expect(await page('authors')).toEqual([`/author/${nicename}/`])
      expect((await visitor.get('/api/v1/public/sitemap/posts/2')).status).toBe(404)
      expect((await visitor.get('/api/v1/public/sitemap/users/1')).status).toBe(400)
    })

    it('reads «noindex» as JSON: a stored value that is not a boolean does not break it', async () => {
      await env.query(`update content set seo = '{"noindex": "kanskje"}'::jsonb where id = $1`, [ids['hidden']])
      try {
        expect((await visitor.get('/api/v1/public/sitemap/posts/1')).status).toBe(200)
      } finally {
        await env.query(`update content set seo = '{"noindex": true}'::jsonb where id = $1`, [ids['hidden']])
      }
    })

    it('splits a part at 2000 addresses', async () => {
      // 2000 more published posts, copied in the database from the one there is (the api would take minutes).
      const columns = (
        await env.query<{ name: string }>(
          `select column_name as name from information_schema.columns
           where table_name = 'content' and table_schema = current_schema()
             and column_name not in ('id', 'short_id', 'slug') and is_generated = 'NEVER'`,
        )
      ).map((row) => `"${row.name}"`)
      await env.query(
        `insert into content (${columns.join(', ')}, slug)
         select ${columns.map((name) => `content.${name}`).join(', ')}, 'kopi-' || g
         from content, generate_series(1, ${String(SITEMAP_MAX_URLS)}) as g where content.id = $1`,
        [ids['hello']],
      )
      try {
        const index = PublicSitemapIndex.parse(await (await visitor.get('/api/v1/public/sitemap')).json())
        expect(index.sitemaps.filter((entry) => entry.kind === 'posts').map((entry) => entry.page)).toEqual([1, 2])
        const first = PublicSitemapPage.parse(await (await visitor.get('/api/v1/public/sitemap/posts/1')).json())
        const second = PublicSitemapPage.parse(await (await visitor.get('/api/v1/public/sitemap/posts/2')).json())
        expect(first.urls).toHaveLength(SITEMAP_MAX_URLS)
        expect(second.urls).toHaveLength(1)
      } finally {
        await env.query(`delete from content where slug like 'kopi-%'`)
      }
    })

    it('is not there when the site asks search engines not to index it', async () => {
      await setSetting(env, 'blog_public', false)
      try {
        expect((await visitor.get('/api/v1/public/sitemap')).status).toBe(404)
        expect((await visitor.get('/api/v1/public/sitemap/posts/1')).status).toBe(404)
      } finally {
        await setSetting(env, 'blog_public', true)
      }
    })
  })
})
