// The content jobs against a real PostgreSQL (M1.1): the scheduler publishes and unpublishes what is due exactly once, also with
// two workers at the same moment, and the purge deletes what has been in the trash for 30 days. Needs TEST_DATABASE_URL.
import { createDb } from '@toascribe/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TRASH_DAYS, runScheduler, runTrashPurge } from '../src/jobs/content.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb } from './harness.ts'
import type { JobDb } from './harness.ts'

noticeIfSkipped('worker content jobs')

const NOW = new Date('2026-10-26T12:00:00.000Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

describe.skipIf(TEST_DATABASE_URL === undefined)('content jobs (needs TEST_DATABASE_URL)', () => {
  let env: JobDb
  let serial = 0

  beforeAll(async () => {
    env = await startJobDb()
  })
  afterAll(async () => {
    await env.close()
  })
  beforeEach(async () => {
    await env.query('delete from content')
  })

  async function item(values: {
    status: string
    publishedAt?: Date | null
    unpublishAt?: Date | null
    before?: string | null
    modifiedAt?: Date
    parentId?: string | null
    type?: string
    slug?: string
  }): Promise<string> {
    serial += 1
    const [row] = await env.query<{ id: string }>(
      `insert into content (type, locale, slug, status, status_before_trash, comment_status, published_at, unpublish_at,
                            modified_at, parent_id)
       values ($1, 'nb', $2, $3, $4, 'closed', $5, $6, $7, $8) returning id`,
      [
        values.type ?? 'post',
        values.slug ?? `s-${String(serial)}`,
        values.status,
        values.before ?? (values.status === 'trash' ? 'draft' : null),
        values.publishedAt ?? null,
        values.unpublishAt ?? null,
        values.modifiedAt ?? NOW,
        values.parentId ?? null,
      ],
    )
    return row?.id ?? ''
  }

  const statusOf = async (id: string) =>
    (await env.query<{ status: string }>('select status from content where id = $1', [id]))[0]?.status

  const run = (now = NOW) => runScheduler({ db: env.db, logger: memoryLogger().logger, now: () => now })

  it('publishes a scheduled item when its time has come, and not before', async () => {
    const due = await item({ status: 'future', publishedAt: new Date(NOW.getTime() - MINUTE) })
    const exact = await item({ status: 'future', publishedAt: NOW })
    const later = await item({ status: 'future', publishedAt: new Date(NOW.getTime() + MINUTE) })
    const draft = await item({ status: 'draft', publishedAt: new Date(NOW.getTime() - DAY) })
    expect(await run()).toEqual({ published: 2, unpublished: 0 })
    expect([await statusOf(due), await statusOf(exact), await statusOf(later), await statusOf(draft)]).toEqual([
      'publish',
      'publish',
      'future',
      'draft',
    ])
    // A second run finds nothing left.
    expect(await run()).toEqual({ published: 0, unpublished: 0 })
    const audit = await env.query<{ action: string; actor: string; actor_type: string; source: string }>(
      `select action, actor, actor_type, source from audit_log where object_id = $1`,
      [due],
    )
    expect(audit).toEqual([
      { action: 'content.published', actor: 'content.scheduler', actor_type: 'system', source: 'job' },
    ])
    // The site drops what it cached of the item and of the post lists (M1.4).
    const tags = await env.query<{ tag: string }>(
      `select tag from cache_invalidation where tag = $1 or tag = 'list:post'`,
      [`content:${due}`],
    )
    expect(tags.map((row) => row.tag).sort()).toEqual([`content:${due}`, 'list:post'])
  })

  it('unpublishes a published item whose time has passed, back to draft, and clears the time', async () => {
    const due = await item({ status: 'publish', publishedAt: new Date(NOW.getTime() - DAY), unpublishAt: NOW })
    const later = await item({ status: 'publish', unpublishAt: new Date(NOW.getTime() + MINUTE) })
    const privateOne = await item({ status: 'private', unpublishAt: new Date(NOW.getTime() - MINUTE) })
    expect(await run()).toEqual({ published: 0, unpublished: 1 })
    const [row] = await env.query<{ status: string; unpublish_at: Date | null }>(
      'select status, unpublish_at from content where id = $1',
      [due],
    )
    expect(row).toEqual({ status: 'draft', unpublish_at: null })
    expect(await statusOf(later)).toBe('publish')
    expect(await statusOf(privateOne)).toBe('private')
  })

  it('publishes and then unpublishes an item whose both times passed while the worker was down', async () => {
    const both = await item({
      status: 'future',
      publishedAt: new Date(NOW.getTime() - 2 * DAY),
      unpublishAt: new Date(NOW.getTime() - DAY),
    })
    expect(await run()).toEqual({ published: 1, unpublished: 1 })
    expect(await statusOf(both)).toBe('draft')
  })

  it('changes each due item exactly once when two workers run at the same moment', async () => {
    const ids: string[] = []
    for (let n = 0; n < 60; n += 1) {
      ids.push(await item({ status: 'future', publishedAt: new Date(NOW.getTime() - n * MINUTE) }))
    }
    // A second worker: its own connection pool, as a second container would have.
    const second = createDb({ connectionString: env.database.appUrl, applicationName: 'toascribe-worker-two', max: 4 })
    try {
      const [a, b, c] = await Promise.all([
        run(),
        runScheduler({ db: second.db, logger: memoryLogger().logger, now: () => NOW }),
        run(),
      ])
      expect(a.published + b.published + c.published).toBe(60)
    } finally {
      await second.pool.end()
    }
    const published = await env.query<{ n: number }>(
      `select count(*)::int as n from content where status = 'publish' and id = any($1)`,
      [ids],
    )
    expect(published[0]?.n).toBe(60)
    // One audit entry per item, never two.
    const twice = await env.query(
      `select object_id from audit_log where action = 'content.published' and object_id = any($1::text[])
       group by object_id having count(*) > 1`,
      [ids],
    )
    expect(twice).toEqual([])
  })

  it(`deletes what has been in the trash for more than ${String(TRASH_DAYS)} days, and keeps the rest`, async () => {
    const old = await item({ status: 'trash', slug: 'gammel__trashed', modifiedAt: new Date(NOW.getTime() - 31 * DAY) })
    const fresh = await item({ status: 'trash', modifiedAt: new Date(NOW.getTime() - 29 * DAY) })
    const oldButLive = await item({ status: 'draft', modifiedAt: new Date(NOW.getTime() - 90 * DAY) })
    const result = await runTrashPurge({ db: env.db, logger: memoryLogger().logger, now: () => NOW })
    expect(result).toEqual({ deleted: 1 })
    expect(await statusOf(old)).toBeUndefined()
    expect(await statusOf(fresh)).toBe('trash')
    expect(await statusOf(oldButLive)).toBe('draft')
    expect(await runTrashPurge({ db: env.db, logger: memoryLogger().logger, now: () => NOW })).toEqual({ deleted: 0 })
    const audit = await env.query<{ action: string; actor: string }>(
      'select action, actor from audit_log where object_id = $1',
      [old],
    )
    expect(audit).toEqual([{ action: 'content.deleted', actor: 'content.trash-purge' }])
  })

  it('moves the child pages of a purged page up to its parent first', async () => {
    const parent = await item({
      type: 'page',
      status: 'trash',
      slug: 'forelder__trashed',
      modifiedAt: new Date(NOW.getTime() - 40 * DAY),
    })
    const child = await item({ type: 'page', status: 'publish', slug: 'barn', parentId: parent })
    await item({ type: 'page', status: 'publish', slug: 'barn' })
    await runTrashPurge({ db: env.db, logger: memoryLogger().logger, now: () => NOW })
    const [row] = await env.query('select parent_id, slug from content where id = $1', [child])
    expect(row).toEqual({ parent_id: null, slug: 'barn-2' })
  })
})
