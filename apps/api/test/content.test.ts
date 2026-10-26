// The content API's behaviour (M1.1): status changes, slugs, search, the lists, the bulk actions and the block check. The rights of
// each role are in content-matrix.test.ts; the pure rules (schedule, tree, rights) in content-rules.test.ts.
import { ContentBulkResponse, ContentItem, ContentListResponse, InvalidBlocksResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('content')

const paragraph = (id: string, text: string) => ({
  id,
  type: 'core/paragraph',
  version: 1,
  attrs: { content: [{ type: 'text', text }] },
  children: [],
})

describe.skipIf(TEST_DATABASE_URL === undefined)('the content API (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let editor: TestClient
  let editorId: string
  let author: TestClient
  let authorId: string
  let contributor: TestClient

  async function signIn(username: string, role: 'editor' | 'author' | 'contributor') {
    const account = await env.createAccount({ username, role })
    const client = env.client()
    expect((await client.login(username, TEST_PASSWORD)).status).toBe(200)
    return { client, id: account.id }
  }

  beforeAll(async () => {
    env = await startAuthApp()
    ;({ client: editor, id: editorId } = await signIn('c-editor', 'editor'))
    ;({ client: author, id: authorId } = await signIn('c-author', 'author'))
    ;({ client: contributor } = await signIn('c-contributor', 'contributor'))
  })

  afterAll(async () => {
    await env.close()
  })

  async function create(client: TestClient, body: Record<string, unknown>): Promise<ContentItem> {
    const res = await client.post('/api/v1/content', { type: 'post', ...body })
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201)
    return ContentItem.parse(await res.json())
  }

  async function patch(client: TestClient, id: string, body: Record<string, unknown>) {
    return client.patch(`/api/v1/content/${id}`, body)
  }

  async function item(res: Response): Promise<ContentItem> {
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    return ContentItem.parse(await res.json())
  }

  async function errorCode(res: Response): Promise<string> {
    const body = (await res.json()) as { error: { code: string } }
    return body.error.code
  }

  describe('a new item', () => {
    it('is a draft by the signed-in account, with comments from the setting, a short link and the defaults', async () => {
      const made = await create(author, { title: 'Første utkast' })
      expect(made).toMatchObject({
        type: 'post',
        status: 'draft',
        locale: 'nb',
        slug: 'forste-utkast',
        commentStatus: 'open',
        visibility: 'public',
        sticky: false,
        publishedAt: null,
        parentId: null,
        blocks: [],
        blocksFormat: 'blocks',
        authors: [{ id: authorId, username: 'c-author' }],
        can: { edit: true, delete: true, publish: true, editOthers: false },
      })
      expect(made.shortLink).toBe(`/?p=${String(made.shortId)}`)
      const page = await create(editor, { type: 'page', title: 'Om oss' })
      expect(page.commentStatus).toBe('closed')
    })

    it('without a title gets its short id as slug, and a slug from the title once it has one (while a draft)', async () => {
      const made = await create(author, {})
      expect(made.slug).toBe(String(made.shortId))
      const titled = await item(await patch(author, made.id, { title: 'Nå med tittel' }))
      expect(titled.slug).toBe('na-med-tittel')
      const retitled = await item(await patch(author, made.id, { title: 'Ny tittel' }))
      expect(retitled.slug).toBe('ny-tittel')
      // A slug someone chose stays when the title changes.
      await item(await patch(author, made.id, { slug: 'Valgt Slug!' }))
      expect((await item(await patch(author, made.id, { title: 'Tredje' }))).slug).toBe('valgt-slug')
    })

    it('keeps the slug of a published item when its title changes', async () => {
      const made = await create(author, { title: 'Publisert tittel', status: 'publish' })
      expect((await item(await patch(author, made.id, { title: 'Annen tittel' }))).slug).toBe('publisert-tittel')
    })
  })

  describe('slugs (K-060)', () => {
    it('turns Norwegian letters into WordPress’ ASCII forms', async () => {
      expect((await create(author, { title: 'Blåbærsyltetøy på Ørland' })).slug).toBe('blabaersyltetoy-pa-orland')
      expect((await create(author, { title: 'x', slug: '  ÆØÅ  æøå ' })).slug).toBe('aeoa-aeoa')
    })

    it('numbers a slug that is taken in the same type and language, from 2', async () => {
      const a = await create(author, { title: 'Kollisjon' })
      const b = await create(author, { title: 'Kollisjon' })
      const c = await create(editor, { title: 'Kollisjon' })
      expect([a.slug, b.slug, c.slug]).toEqual(['kollisjon', 'kollisjon-2', 'kollisjon-3'])
      // A page is another type: its own slug.
      expect((await create(editor, { type: 'page', title: 'Kollisjon' })).slug).toBe('kollisjon')
    })

    it('gives a trashed item __trashed, frees its slug, and numbers it on restore when it was taken meanwhile', async () => {
      const first = await create(author, { title: 'Papirkurv' })
      const trashed = await item(await author.post(`/api/v1/content/${first.id}/trash`))
      expect(trashed).toMatchObject({ status: 'trash', slug: 'papirkurv__trashed', statusBeforeTrash: 'draft' })
      const second = await create(author, { title: 'Papirkurv' })
      expect(second.slug).toBe('papirkurv')
      const restored = await item(await author.post(`/api/v1/content/${first.id}/restore`))
      expect(restored).toMatchObject({ status: 'draft', slug: 'papirkurv-2', statusBeforeTrash: null })
    })

    it('restores the slug itself when nobody took it', async () => {
      const made = await create(author, { title: 'Tilbake igjen', status: 'publish' })
      await author.post(`/api/v1/content/${made.id}/trash`)
      const restored = await item(await author.post(`/api/v1/content/${made.id}/restore`))
      expect(restored).toMatchObject({ status: 'publish', slug: 'tilbake-igjen' })
    })

    it('makes a slug unique under the parent of a page, and again when the page moves', async () => {
      const parent = await create(editor, { type: 'page', title: 'Forelder' })
      const top = await create(editor, { type: 'page', title: 'Barn' })
      const child = await create(editor, { type: 'page', title: 'Barn', parentId: parent.id })
      expect(child.slug).toBe('barn')
      const moved = await item(await patch(editor, child.id, { parentId: null }))
      expect(moved.slug).toBe('barn-2')
      expect(top.slug).toBe('barn')
    })
  })

  describe('status changes (K-061, K-070)', () => {
    it('lets a contributor send for review, and refuses publish, schedule and private', async () => {
      const made = await create(contributor, { title: 'Til gjennomgang' })
      expect((await item(await patch(contributor, made.id, { status: 'pending' }))).status).toBe('pending')
      for (const status of ['publish', 'future', 'private']) {
        const res = await patch(contributor, made.id, {
          status,
          publishedAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        expect(res.status, status).toBe(403)
        expect(await errorCode(res)).toBe('cannot_publish')
      }
      expect((await contributor.post(`/api/v1/content/${made.id}/publish`)).status).toBe(403)
      // The editor publishes it.
      const published = await item(await editor.post(`/api/v1/content/${made.id}/publish`))
      expect(published.status).toBe('publish')
      expect(published.publishedAt).not.toBeNull()
    })

    it('goes through every allowed change of an editor', async () => {
      const made = await create(editor, { title: 'Overganger' })
      const future = new Date(Date.now() + 86_400_000).toISOString()
      const steps: [Record<string, unknown>, string][] = [
        [{ status: 'pending' }, 'pending'],
        [{ status: 'draft' }, 'draft'],
        [{ status: 'future', publishedAt: future }, 'future'],
        [{ status: 'draft' }, 'draft'],
        [{ status: 'publish', publishedAt: null }, 'publish'],
        [{ status: 'private' }, 'private'],
        [{ status: 'publish' }, 'publish'],
        [{ status: 'pending' }, 'pending'],
      ]
      for (const [body, status] of steps) {
        expect((await item(await patch(editor, made.id, body))).status, JSON.stringify(body)).toBe(status)
      }
    })

    it('schedules a publish date in the future, and publishes a scheduled date that has passed', async () => {
      const later = new Date(Date.now() + 3_600_000).toISOString()
      const scheduled = await create(editor, { title: 'Planlagt', status: 'publish', publishedAt: later })
      expect(scheduled.status).toBe('future')
      expect(scheduled.publishedAt).toBe(later)
      const earlier = new Date(Date.now() - 3_600_000).toISOString()
      expect((await create(editor, { title: 'Allerede', status: 'future', publishedAt: earlier })).status).toBe(
        'publish',
      )
    })

    it('refuses the changes that are not allowed', async () => {
      const made = await create(editor, { title: 'Ulovlig' })
      const cases: [Record<string, unknown>, number, string][] = [
        [{ status: 'trash' }, 400, 'validation_error'],
        [{ status: 'future' }, 400, 'invalid_schedule'],
        [{ status: 'future', publishedAt: null }, 400, 'invalid_schedule'],
        [{ status: 'publish', unpublishAt: new Date(Date.now() - 1000).toISOString() }, 400, 'invalid_schedule'],
        [{ status: 'private', password: 'hemmelig' }, 400, 'private_with_password'],
        [{ parentId: made.id }, 400, 'invalid_parent'],
        [{ authors: ['0198a3c2-0000-7000-8000-0000000000ff'] }, 400, 'invalid_author'],
      ]
      for (const [body, status, code] of cases) {
        const res = await patch(editor, made.id, body)
        expect(res.status, JSON.stringify(body)).toBe(status)
        expect(await errorCode(res), JSON.stringify(body)).toBe(code)
      }
      expect((await item(await editor.get(`/api/v1/content/${made.id}`))).status).toBe('draft')
    })

    it('keeps a trashed item as it is until it is restored, and refuses to trash, restore or delete twice', async () => {
      const made = await create(author, { title: 'Låst i papirkurven' })
      expect((await author.post(`/api/v1/content/${made.id}/restore`)).status).toBe(409)
      expect(await errorCode(await author.delete(`/api/v1/content/${made.id}`))).toBe('not_trashed')
      expect((await author.post(`/api/v1/content/${made.id}/trash`)).status).toBe(200)
      const again = await author.post(`/api/v1/content/${made.id}/trash`)
      expect([again.status, await errorCode(again)]).toEqual([409, 'content_trashed'])
      const edit = await patch(author, made.id, { title: 'Nei' })
      expect([edit.status, await errorCode(edit)]).toEqual([409, 'content_trashed'])
      expect((await author.post(`/api/v1/content/${made.id}/publish`)).status).toBe(409)
      expect((await author.delete(`/api/v1/content/${made.id}`)).status).toBe(204)
      expect((await author.get(`/api/v1/content/${made.id}`)).status).toBe(404)
    })

    it('lets only those who may publish and edit others’ posts make a post sticky, and never a page', async () => {
      const post = await create(author, { title: 'Klebrig' })
      const refused = await patch(author, post.id, { sticky: true })
      expect([refused.status, await errorCode(refused)]).toEqual([403, 'cannot_stick'])
      expect((await item(await patch(editor, post.id, { sticky: true }))).sticky).toBe(true)
      const page = await create(editor, { type: 'page', title: 'Side' })
      expect(await errorCode(await patch(editor, page.id, { sticky: true }))).toBe('sticky_not_supported')
    })

    it('hashes a post password and never returns it; «Privat» removes it', async () => {
      const made = await create(editor, { title: 'Passord', password: 'hemmelig' })
      expect(made.visibility).toBe('password')
      expect(JSON.stringify(made)).not.toContain('hemmelig')
      const [row] = await env.query<{ password_hash: string }>('select password_hash from content where id = $1', [
        made.id,
      ])
      expect(row?.password_hash).toMatch(/^\$argon2id\$/)
      expect((await item(await patch(editor, made.id, { status: 'private' }))).visibility).toBe('private')
      const [after] = await env.query('select password_hash from content where id = $1', [made.id])
      expect(after).toEqual({ password_hash: null })
    })

    it('needs edit_others to choose authors, and an author who can edit the type (K-066)', async () => {
      const made = await create(author, { title: 'Forfattere' })
      const refused = await patch(author, made.id, { authors: [authorId, editorId] })
      expect([refused.status, await errorCode(refused)]).toEqual([403, 'cannot_assign_authors'])
      const both = await item(await patch(editor, made.id, { authors: [editorId, authorId] }))
      expect(both.authors.map((entry) => entry.id)).toEqual([editorId, authorId])
      const subscriber = await env.createAccount({ username: 'c-subscriber', role: 'subscriber' })
      expect(await errorCode(await patch(editor, made.id, { authors: [subscriber.id] }))).toBe('invalid_author')
    })

    it('lets a draft with an unpublish date that has passed still be saved', async () => {
      const made = await create(editor, { title: 'Gammel avpublisering' })
      await env.query(`update content set unpublish_at = now() - interval '1 day' where id = $1`, [made.id])
      expect((await item(await patch(editor, made.id, { title: 'Fortsatt lagret' }))).title).toBe('Fortsatt lagret')
      // Publishing it with that date in the past is refused.
      expect(await errorCode(await patch(editor, made.id, { status: 'publish' }))).toBe('invalid_schedule')
    })

    it('needs the publish capability to restore an item to a publishing status', async () => {
      // A role that may delete others' posts but not publish (not a built-in one; an administrator could make it).
      await env.query(
        `insert into role (slug, name, capabilities) values ('trash-keeper', 'Trash keeper',
          array['read','edit_posts','edit_others_posts','edit_published_posts','delete_posts','delete_others_posts','delete_published_posts'])`,
      )
      const keeper = await env.createAccount({ username: 'c-keeper', role: null })
      await env.query(
        `insert into account_role (account_id, role_id) select $1, id from role where slug = 'trash-keeper'`,
        [keeper.id],
      )
      const client = env.client()
      expect((await client.login('c-keeper', TEST_PASSWORD)).status).toBe(200)
      const published = await create(editor, { title: 'Publisert og kastet', status: 'publish' })
      expect((await client.post(`/api/v1/content/${published.id}/trash`)).status).toBe(200)
      const refused = await client.post(`/api/v1/content/${published.id}/restore`)
      expect([refused.status, await errorCode(refused)]).toEqual([403, 'cannot_publish'])
      const draft = await create(editor, { title: 'Utkast og kastet' })
      expect((await client.post(`/api/v1/content/${draft.id}/trash`)).status).toBe(200)
      expect((await client.post(`/api/v1/content/${draft.id}/restore`)).status).toBe(200)
    })

    it('refuses a disabled account as a new author', async () => {
      const made = await create(editor, { title: 'Ikke aktiv' })
      const disabled = await env.createAccount({ username: 'c-disabled', role: 'author', status: 'disabled' })
      expect(await errorCode(await patch(editor, made.id, { authors: [disabled.id] }))).toBe('invalid_author')
    })

    it('refuses a page as its own grandparent', async () => {
      const top = await create(editor, { type: 'page', title: 'Topp' })
      const middle = await create(editor, { type: 'page', title: 'Midt', parentId: top.id })
      const bottom = await create(editor, { type: 'page', title: 'Bunn', parentId: middle.id })
      expect(await errorCode(await patch(editor, top.id, { parentId: bottom.id }))).toBe('invalid_parent')
    })
  })

  describe('blocks and search', () => {
    it('stores blocks that pass their block.json, with the defaults, and refuses the rest with the issues', async () => {
      const made = await create(author, {
        title: 'Blokker',
        blocks: [{ id: 'b_img00001', type: 'core/image', version: 1, attrs: { url: '/bilde.png' }, children: [] }],
      })
      expect(made.blocks[0]).toMatchObject({ attrs: { url: '/bilde.png', alt: '', caption: '' } })
      for (const blocks of [
        [{ ...paragraph('b_bad00001', 'x'), type: 'core/html' }],
        [{ ...paragraph('b_bad00002', 'x'), attrs: { content: '<script>alert(1)</script>' } }],
        [
          {
            ...paragraph('b_bad00003', 'x'),
            attrs: {
              content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
            },
          },
        ],
      ]) {
        const res = await patch(author, made.id, { blocks })
        expect(res.status).toBe(400)
        const body = InvalidBlocksResponse.parse(await res.json())
        expect(body.error.code).toBe('invalid_blocks')
        expect(body.issues.length).toBeGreaterThan(0)
      }
    })

    it('finds text in the title, the excerpt and the blocks, also by the start of a word', async () => {
      const inTitle = await create(editor, { title: 'Rabarbrasuppe', status: 'publish' })
      const inExcerpt = await create(editor, { title: 'To', excerpt: 'Om tyttebærsyltetøy', status: 'publish' })
      const inBlocks = await create(editor, {
        title: 'Tre',
        status: 'publish',
        blocks: [paragraph('b_s0000001', 'Her står det om multekrem i teksten')],
      })
      const search = async (text: string) => {
        const res = await editor.get(`/api/v1/content?type=post&search=${encodeURIComponent(text)}`)
        return ContentListResponse.parse(await res.json()).items.map((entry) => entry.id)
      }
      expect(await search('rabarbrasuppe')).toEqual([inTitle.id])
      expect(await search('tyttebær')).toEqual([inExcerpt.id])
      expect(await search('multekrem')).toEqual([inBlocks.id])
      expect(await search('multe')).toEqual([inBlocks.id])
      expect(await search('rabarbra')).toEqual([inTitle.id])
      // The vector is rebuilt when the blocks change.
      await patch(editor, inBlocks.id, { blocks: [paragraph('b_s0000001', 'Nå handler det om kanelsnurrer')] })
      expect(await search('multekrem')).toEqual([])
      expect(await search('kanelsnurrer')).toEqual([inBlocks.id])
    })

    it('shows the items of the install, in WordPress’ parsed form, as legacy blocks and finds their text', async () => {
      const [row] = await env.query<{ id: string }>(
        `insert into content (type, locale, slug, title, status, comment_status, published_at, blocks, search)
         values ('post', 'nb', 'hei-legacy', 'Hei, verden!', 'publish', 'open', now(),
           '[{"blockName":"core/paragraph","attrs":{},"innerBlocks":[],"innerHTML":"<p>Velkommen til WordPress</p>","innerContent":["<p>Velkommen til WordPress</p>"]}]',
           ''::tsvector) returning id`,
      )
      await env.query('insert into content_author (content_id, account_id) values ($1, $2)', [row?.id, editorId])
      const legacy = await item(await editor.get(`/api/v1/content/${row?.id ?? ''}`))
      expect(legacy.blocksFormat).toBe('legacy')
      // A change of the title rebuilds the vector from the parsed blocks too.
      await patch(editor, legacy.id, { excerpt: 'Utdrag' })
      const res = await editor.get('/api/v1/content?type=post&search=velkommen')
      expect(ContentListResponse.parse(await res.json()).items.map((entry) => entry.id)).toContain(legacy.id)
    })
  })

  describe('the lists (K-034)', () => {
    let lister: TestClient
    let listerId: string

    beforeAll(async () => {
      ;({ client: lister, id: listerId } = await signIn('c-lister', 'editor'))
    })

    it('pages with X-Total-Count and X-Total-Pages, counts the views and filters by author', async () => {
      for (let n = 1; n <= 5; n += 1) {
        await create(lister, { title: `Liste ${String(n)}`, status: n <= 3 ? 'publish' : 'draft' })
      }
      const res = await lister.get(`/api/v1/content?type=post&author=${listerId}&per_page=2&page=2`)
      expect(res.headers.get('x-total-count')).toBe('5')
      expect(res.headers.get('x-total-pages')).toBe('3')
      const body = ContentListResponse.parse(await res.json())
      expect(body).toMatchObject({ total: 5, totalPages: 3, page: 2, perPage: 2 })
      expect(body.items).toHaveLength(2)
      expect(body.counts.mine).toBe(5)
      expect(body.counts.all).toBeGreaterThanOrEqual(5)
      const drafts = await lister.get(`/api/v1/content?type=post&author=${listerId}&status=draft`)
      expect(ContentListResponse.parse(await drafts.json()).total).toBe(2)
    })

    it('sorts by title and by date, newest first by default', async () => {
      const res = await lister.get(`/api/v1/content?type=post&author=${listerId}&orderby=title&order=desc`)
      const titles = ContentListResponse.parse(await res.json()).items.map((entry) => entry.title)
      expect(titles).toEqual(['Liste 5', 'Liste 4', 'Liste 3', 'Liste 2', 'Liste 1'])
      const byDate = ContentListResponse.parse(
        await (await lister.get(`/api/v1/content?type=post&author=${listerId}`)).json(),
      )
      const dates = byDate.items.map((entry) => entry.publishedAt ?? entry.modifiedAt)
      expect([...dates].sort().reverse()).toEqual(dates)
    })

    it('filters by month in the site’s time zone and lists the months', async () => {
      // 23:30 UTC on 31 October is 00:30 on 1 November in Oslo: a November post on a Norwegian site.
      const made = await create(lister, {
        title: 'Allehelgen',
        status: 'publish',
        publishedAt: '2025-10-31T23:30:00.000Z',
      })
      const november = await lister.get('/api/v1/content?type=post&month=2025-11')
      expect(ContentListResponse.parse(await november.json()).items.map((entry) => entry.id)).toEqual([made.id])
      const october = await lister.get('/api/v1/content?type=post&month=2025-10')
      expect(ContentListResponse.parse(await october.json()).items.map((entry) => entry.id)).not.toContain(made.id)
      const list = ContentListResponse.parse(await (await lister.get('/api/v1/content?type=post')).json())
      expect(list.months).toContain('2025-11')
      expect(list.timeZone).toBe('Europe/Oslo')
    })

    it('shows pages as a tree with the depth of each, children after their parent', async () => {
      const parent = await create(lister, { type: 'page', title: 'Tre A', menuOrder: 1 })
      const child = await create(lister, { type: 'page', title: 'Tre A1', parentId: parent.id })
      const grandchild = await create(lister, { type: 'page', title: 'Tre A1a', parentId: child.id })
      const sibling = await create(lister, { type: 'page', title: 'Tre B', menuOrder: 2 })
      const res = await lister.get(`/api/v1/content?type=page&author=${listerId}&per_page=100`)
      const items = ContentListResponse.parse(await res.json()).items
      const order = items.map((entry) => [entry.id, entry.depth])
      const index = (id: string) => order.findIndex(([entryId]) => entryId === id)
      expect(order[index(parent.id)]).toEqual([parent.id, 0])
      expect(order[index(parent.id) + 1]).toEqual([child.id, 1])
      expect(order[index(parent.id) + 2]).toEqual([grandchild.id, 2])
      expect(index(sibling.id)).toBeGreaterThan(index(grandchild.id))
    })

    it('refuses an unknown parameter and a page size above 100', async () => {
      expect((await lister.get('/api/v1/content?type=post&perPage=5')).status).toBe(400)
      expect((await lister.get('/api/v1/content?type=post&per_page=101')).status).toBe(400)
      expect((await lister.get('/api/v1/content')).status).toBe(400)
    })
  })

  describe('bulk actions (K-035)', () => {
    it('trashes, restores, edits and deletes, item by item, and names what it left alone', async () => {
      const a = await create(editor, { title: 'Masse A', status: 'publish' })
      const b = await create(editor, { title: 'Masse B' })
      const bulk = async (body: Record<string, unknown>) => {
        const res = await editor.post('/api/v1/content/bulk', body)
        expect(res.status).toBe(200)
        return ContentBulkResponse.parse(await res.json())
      }
      expect(
        await bulk({ action: 'edit', ids: [a.id, b.id], changes: { status: 'pending', commentStatus: 'closed' } }),
      ).toEqual({
        changed: [a.id, b.id],
        unchanged: [],
        skipped: [],
      })
      expect(await bulk({ action: 'edit', ids: [a.id], changes: { status: 'pending' } })).toEqual({
        changed: [],
        unchanged: [a.id],
        skipped: [],
      })
      expect(await bulk({ action: 'trash', ids: [a.id, b.id] })).toMatchObject({ changed: [a.id, b.id] })
      expect(await bulk({ action: 'edit', ids: [a.id], changes: { status: 'draft' } })).toEqual({
        changed: [],
        unchanged: [],
        skipped: [{ id: a.id, reason: 'trashed' }],
      })
      expect(await bulk({ action: 'restore', ids: [a.id] })).toMatchObject({ changed: [a.id] })
      expect(await bulk({ action: 'delete', ids: [a.id, b.id] })).toEqual({
        changed: [b.id],
        unchanged: [],
        skipped: [{ id: a.id, reason: 'not_trashed' }],
      })
      const restored = await item(await editor.get(`/api/v1/content/${a.id}`))
      expect(restored).toMatchObject({ status: 'pending', commentStatus: 'closed' })
    })

    it('empties the trash of one type, only what the account may delete', async () => {
      const mine = await create(author, { title: 'Tøm min' })
      const theirs = await create(editor, { title: 'Tøm deres' })
      await author.post(`/api/v1/content/${mine.id}/trash`)
      await editor.post(`/api/v1/content/${theirs.id}/trash`)
      const res = await author.post('/api/v1/content/bulk', { action: 'empty_trash', type: 'post' })
      const body = ContentBulkResponse.parse(await res.json())
      expect(body.changed).toContain(mine.id)
      expect(body.changed).not.toContain(theirs.id)
      expect(body.skipped).toEqual([])
      expect((await editor.get(`/api/v1/content/${theirs.id}`)).status).toBe(200)
    })
  })

  it('lists the accounts that can write posts or pages as possible authors, for those who may choose them', async () => {
    const posts = (await (await editor.get('/api/v1/content/authors?type=post')).json()) as {
      authors: { username: string }[]
    }
    const names = posts.authors.map((entry) => entry.username)
    expect(names).toEqual(expect.arrayContaining(['c-editor', 'c-author', 'c-contributor']))
    const pages = (await (await editor.get('/api/v1/content/authors?type=page')).json()) as {
      authors: { username: string }[]
    }
    expect(pages.authors.map((entry) => entry.username)).not.toContain('c-author')
    expect((await author.get('/api/v1/content/authors?type=post')).status).toBe(403)
  })

  it('writes who did what to the audit log, never the password', async () => {
    const made = await create(editor, { title: 'Revisjon', password: 'aldri-i-loggen' })
    await editor.post(`/api/v1/content/${made.id}/trash`)
    const rows = await env.query<{ action: string; actor: string; new_value: unknown }>(
      `select action, actor, new_value from audit_log where object_id = $1 order by created_at, action`,
      [made.id],
    )
    expect(rows.map((row) => row.action)).toEqual(['content.created', 'content.trashed'])
    expect(rows.every((row) => row.actor === 'c-editor')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('aldri-i-loggen')
  })

  it('counts published posts and pages on the dashboard from the same counts', async () => {
    const glance = (await (await editor.get('/api/v1/dashboard/glance')).json()) as { posts: number; pages: number }
    const posts = ContentListResponse.parse(await (await editor.get('/api/v1/content?type=post&per_page=1')).json())
    const pages = ContentListResponse.parse(await (await editor.get('/api/v1/content?type=page&per_page=1')).json())
    expect(glance.posts).toBe(posts.counts.publish)
    expect(glance.pages).toBe(pages.counts.publish)
  })
})
