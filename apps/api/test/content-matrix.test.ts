// The rights matrix of the content API (M1.1): the five built-in roles against every content endpoint, for posts and for pages,
// on their own items and on someone else's, published and not. The expected statuses are written out by hand from WordPress'
// map_meta_cap() and the roles of populate_roles(), not worked out by the code under test. Every case gets a fresh item, so an
// action that changes it (publish, trash) cannot disturb the next case.
import { BUILT_IN_ROLES } from '@toascribe/shared'
import type { BuiltInRole } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('content-matrix')

type Type = 'post' | 'page'
type Fixture =
  | 'ownDraft'
  | 'ownPublished'
  | 'othersDraft'
  | 'othersPending'
  | 'othersPublished'
  | 'othersPrivate'
  | 'ownTrashed'
  | 'othersTrashed'
  | 'othersTrashedPrivate'
type Operation = 'get' | 'patch' | 'publish' | 'trash' | 'restore' | 'delete'

/** Statuses in the order administrator, editor, author, contributor, subscriber. */
type Row = readonly [number, number, number, number, number]

const ROLE_INDEX: Record<BuiltInRole, number> = {
  administrator: 0,
  editor: 1,
  author: 2,
  contributor: 3,
  subscriber: 4,
}

// Posts. The subscriber has no edit_posts, so the route's guard turns it away (403) before the item is looked at. An item the
// account may not see (someone else's draft, pending, private or trashed item without edit_others_posts / read_private_posts) is a 404.
const POSTS: Readonly<Record<Fixture, Partial<Record<Operation, Row>>>> = {
  ownDraft: {
    get: [200, 200, 200, 200, 403],
    patch: [200, 200, 200, 200, 403],
    // The contributor may write, not publish (K-070).
    publish: [200, 200, 200, 403, 403],
    trash: [200, 200, 200, 200, 403],
  },
  // Published by its author: the contributor lacks edit_published_posts and delete_published_posts.
  ownPublished: {
    get: [200, 200, 200, 200, 403],
    patch: [200, 200, 200, 403, 403],
    publish: [200, 200, 200, 403, 403],
    trash: [200, 200, 200, 403, 403],
  },
  othersDraft: {
    get: [200, 200, 404, 404, 403],
    patch: [200, 200, 404, 404, 403],
    publish: [200, 200, 404, 404, 403],
    trash: [200, 200, 404, 404, 403],
  },
  // A contributor's post sent for review: an editor publishes it, the author (no edit_others_posts) cannot see it.
  othersPending: {
    get: [200, 200, 404, 404, 403],
    patch: [200, 200, 404, 404, 403],
    publish: [200, 200, 404, 404, 403],
    trash: [200, 200, 404, 404, 403],
  },
  // Published by someone else: everyone who can edit posts reads it; only edit_others_posts changes it.
  othersPublished: {
    get: [200, 200, 200, 200, 403],
    patch: [200, 200, 403, 403, 403],
    publish: [200, 200, 403, 403, 403],
    trash: [200, 200, 403, 403, 403],
  },
  othersPrivate: {
    get: [200, 200, 404, 404, 403],
    patch: [200, 200, 404, 404, 403],
    publish: [200, 200, 404, 404, 403],
    trash: [200, 200, 404, 404, 403],
  },
  // Trashed while a draft: its own author may restore and delete it.
  ownTrashed: {
    get: [200, 200, 200, 200, 403],
    patch: [409, 409, 409, 409, 403],
    restore: [200, 200, 200, 200, 403],
    delete: [204, 204, 204, 204, 403],
  },
  // Someone else's, trashed while published: only edit_others_posts can see it in the trash.
  othersTrashed: {
    get: [200, 200, 404, 404, 403],
    restore: [200, 200, 404, 404, 403],
    delete: [204, 204, 404, 404, 403],
  },
  // Someone else's, trashed while private: the trash keeps it private (read_private_posts and edit_private_posts are needed).
  othersTrashedPrivate: {
    get: [200, 200, 404, 404, 403],
    restore: [200, 200, 404, 404, 403],
    delete: [204, 204, 404, 404, 403],
  },
}

/** Pages: the author and the contributor have no edit_pages, so no page is theirs to see (404), their own included. */
function pagesRow(posts: Row): Row {
  return [posts[0], posts[1], 404, 404, 403]
}

const PAGES: Readonly<Record<Fixture, Partial<Record<Operation, Row>>>> = Object.fromEntries(
  Object.entries(POSTS).map(([fixture, operations]) => [
    fixture,
    Object.fromEntries(Object.entries(operations).map(([operation, row]) => [operation, pagesRow(row)])),
  ]),
) as Record<Fixture, Partial<Record<Operation, Row>>>

describe.skipIf(TEST_DATABASE_URL === undefined)('content rights matrix (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  const accounts = new Map<BuiltInRole, { id: string; client: TestClient }>()
  let otherId: string
  let contributorOtherId: string

  beforeAll(async () => {
    env = await startAuthApp()
    for (const role of BUILT_IN_ROLES) {
      const account = await env.createAccount({ username: `cm-${role}`, role })
      const client = env.client()
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      accounts.set(role, { id: account.id, client })
    }
    otherId = (await env.createAccount({ username: 'cm-other', role: 'editor' })).id
    contributorOtherId = (await env.createAccount({ username: 'cm-other-contributor', role: 'contributor' })).id
  })

  afterAll(async () => {
    await env.close()
  })

  let serial = 0

  /** A fresh item for one case, written straight into the database as its author would have left it. */
  async function fixture(type: Type, kind: Fixture, role: BuiltInRole): Promise<string> {
    serial += 1
    const own = kind.startsWith('own')
    const author = own ? (accounts.get(role)?.id ?? '') : kind === 'othersPending' ? contributorOtherId : otherId
    const status: Record<Fixture, [string, string | null]> = {
      ownDraft: ['draft', null],
      ownPublished: ['publish', null],
      othersDraft: ['draft', null],
      othersPending: ['pending', null],
      othersPublished: ['publish', null],
      othersPrivate: ['private', null],
      ownTrashed: ['trash', 'draft'],
      othersTrashed: ['trash', 'publish'],
      othersTrashedPrivate: ['trash', 'private'],
    }
    const [current, before] = status[kind]
    const published = current === 'publish' || before === 'publish' || current === 'private'
    const [row] = await env.query<{ id: string }>(
      `insert into content (type, locale, slug, title, status, status_before_trash, comment_status, published_at)
       values ($1, 'nb', $2, $3, $4, $5, 'closed', $6) returning id`,
      [
        type,
        `cm-${String(serial)}${current === 'trash' ? '__trashed' : ''}`,
        `Matrise ${String(serial)}`,
        current,
        before,
        published ? new Date(Date.now() - 60_000) : null,
      ],
    )
    const id = row?.id ?? ''
    await env.query('insert into content_author (content_id, account_id) values ($1, $2)', [id, author])
    return id
  }

  function call(client: TestClient, operation: Operation, id: string): Promise<Response> {
    switch (operation) {
      case 'get':
        return client.get(`/api/v1/content/${id}`)
      case 'patch':
        return client.patch(`/api/v1/content/${id}`, { title: 'Endret' })
      case 'delete':
        return client.delete(`/api/v1/content/${id}`)
      default:
        return client.post(`/api/v1/content/${id}/${operation}`)
    }
  }

  const cases: [Type, Fixture, Operation, BuiltInRole, number][] = []
  for (const [type, table] of [
    ['post', POSTS],
    ['page', PAGES],
  ] as const) {
    for (const [kind, operations] of Object.entries(table) as [Fixture, Partial<Record<Operation, Row>>][]) {
      for (const [operation, row] of Object.entries(operations) as [Operation, Row][]) {
        for (const role of BUILT_IN_ROLES) {
          cases.push([type, kind, operation, role, row[ROLE_INDEX[role]] ?? 0])
        }
      }
    }
  }

  it.each(cases)('%s %s: %s as %s answers %i', async (type, kind, operation, role, expected) => {
    const id = await fixture(type, kind, role)
    const account = accounts.get(role)
    if (account === undefined) throw new Error('no account')
    const res = await call(account.client, operation, id)
    expect(res.status).toBe(expected)
  })

  it.each([
    ['post', [200, 200, 200, 200, 403]],
    ['page', [200, 200, 403, 403, 403]],
  ] as const)('lists %ss for the roles that may edit them', async (type, row) => {
    for (const role of BUILT_IN_ROLES) {
      const res = await accounts.get(role)?.client.get(`/api/v1/content?type=${type}`)
      expect(res?.status, role).toBe(row[ROLE_INDEX[role]])
    }
  })

  it.each([
    ['post', 'draft', [201, 201, 201, 201, 403]],
    ['post', 'pending', [201, 201, 201, 201, 403]],
    ['post', 'publish', [201, 201, 201, 403, 403]],
    ['post', 'private', [201, 201, 201, 403, 403]],
    ['page', 'draft', [201, 201, 403, 403, 403]],
    ['page', 'publish', [201, 201, 403, 403, 403]],
  ] as const)('makes a %s as %s for the roles that may', async (type, status, row) => {
    for (const role of BUILT_IN_ROLES) {
      const res = await accounts.get(role)?.client.post('/api/v1/content', { type, status, title: `Ny ${status}` })
      expect(res?.status, role).toBe(row[ROLE_INDEX[role]])
    }
  })

  it('leaves someone else’s private post out of the list without read_private_posts, and counts it only with it', async () => {
    const id = await fixture('post', 'othersPrivate', 'author')
    for (const [role, sees] of [
      ['editor', true],
      ['author', false],
      ['contributor', false],
    ] as const) {
      const res = await accounts.get(role)?.client.get('/api/v1/content?type=post&status=private&per_page=100')
      const body = (await res?.json()) as { items: { id: string }[]; counts: { private: number } }
      expect(
        body.items.some((item) => item.id === id),
        role,
      ).toBe(sees)
      // The count is the private posts the role may see: all of them, or only its own.
      const [visible] = await env.query<{ n: number }>(
        `select count(*)::int as n from content c where c.type = 'post' and c.status = 'private'
           and ($1 or exists (select 1 from content_author a where a.content_id = c.id and a.account_id = $2))`,
        [sees, accounts.get(role)?.id],
      )
      expect(body.counts.private, role).toBe(visible?.n)
    }
  })

  it('keeps someone else’s private post out of the trash view without read_private_posts', async () => {
    const id = await fixture('post', 'othersTrashedPrivate', 'contributor')
    for (const [role, sees] of [
      ['editor', true],
      ['contributor', false],
    ] as const) {
      const res = await accounts.get(role)?.client.get('/api/v1/content?type=post&status=trash&per_page=100')
      const body = (await res?.json()) as { items: { id: string }[] }
      expect(
        body.items.some((item) => item.id === id),
        role,
      ).toBe(sees)
    }
  })

  it('lets an author edit and trash a post someone else made with them as co-author (K-066)', async () => {
    const id = await fixture('post', 'othersDraft', 'author')
    await env.query('insert into content_author (content_id, account_id, sort) values ($1, $2, 1)', [
      id,
      accounts.get('author')?.id,
    ])
    const client = accounts.get('author')?.client
    expect((await client?.patch(`/api/v1/content/${id}`, { title: 'Sammen' }))?.status).toBe(200)
    expect((await client?.post(`/api/v1/content/${id}/trash`))?.status).toBe(200)
  })

  it('answers bulk actions item by item: what the account may not touch is skipped as forbidden or not found', async () => {
    const mine = await fixture('post', 'ownDraft', 'author')
    const theirs = await fixture('post', 'othersPublished', 'author')
    const hidden = await fixture('post', 'othersDraft', 'author')
    const res = await accounts.get('author')?.client.post('/api/v1/content/bulk', {
      action: 'trash',
      ids: [mine, theirs, hidden],
    })
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({
      changed: [mine],
      unchanged: [],
      skipped: [
        { id: theirs, reason: 'forbidden' },
        { id: hidden, reason: 'not_found' },
      ],
    })
  })
})
