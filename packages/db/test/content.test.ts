// The content helpers the api and the worker share (M1.1): free slugs as WordPress finds them, and a permanent delete that moves
// the children up first. Also migration 0007, which deletes the editor prototype's drafts and nothing else.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deleteContentPermanently, isReservedSlug, legacyBlocksText, uniqueContentSlug } from '../src/content.ts'
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrator.ts'
import * as schema from '../src/schema/index.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('content')

const logger = pino({ level: 'silent' })

describe('slug rules without a database', () => {
  it('reserves the feed names everywhere, and numbers for pages only', () => {
    expect(isReservedSlug('feed', 'post')).toBe(true)
    expect(isReservedSlug('embed', 'page')).toBe(true)
    expect(isReservedSlug('2', 'page')).toBe(true)
    expect(isReservedSlug('page3', 'page')).toBe(true)
    expect(isReservedSlug('2', 'post')).toBe(false)
    expect(isReservedSlug('2026-plan', 'page')).toBe(false)
  })

  it('reads the text of WordPress’ parsed blocks', () => {
    const blocks = [
      { blockName: 'core/paragraph', innerHTML: '<p>Hei &amp; <strong>velkommen</strong>&#33;</p>', innerBlocks: [] },
      { blockName: 'core/group', innerHTML: '<div></div>', innerBlocks: [{ innerHTML: '<p>Inni&nbsp;gruppen</p>' }] },
      'not a block',
    ]
    expect(legacyBlocksText(blocks)).toBe('Hei & velkommen ! Inni gruppen')
    expect(legacyBlocksText(null)).toBe('')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('content helpers (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let pool: pg.Pool
  let db: ReturnType<typeof drizzle<typeof schema>>

  async function insert(values: { type?: string; slug: string; parentId?: string | null; status?: string }) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into content (type, locale, slug, status, status_before_trash, comment_status, parent_id)
       values ($1, 'nb', $2, $3, $4, 'closed', $5) returning id`,
      [
        values.type ?? 'page',
        values.slug,
        values.status ?? 'draft',
        values.status === 'trash' ? 'draft' : null,
        values.parentId ?? null,
      ],
    )
    const id = rows[0]?.id
    if (id === undefined) throw new Error('no row')
    return id
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger })
    pool = new pg.Pool({ connectionString: database.appUrl })
    db = drizzle({ client: pool, schema, casing: 'snake_case' })
  })

  afterAll(async () => {
    await pool.end()
    await database.drop()
  })

  it('numbers a slug that is taken in the same type, language and parent, from 2', async () => {
    const top = { type: 'post', locale: 'nb', parentId: null }
    expect(await db.transaction((tx) => uniqueContentSlug(tx, top, 'hei'))).toBe('hei')
    await insert({ type: 'post', slug: 'hei' })
    await insert({ type: 'post', slug: 'hei-2' })
    expect(await db.transaction((tx) => uniqueContentSlug(tx, top, 'hei'))).toBe('hei-3')
    // Another type, another language or another parent is another scope.
    expect(await db.transaction((tx) => uniqueContentSlug(tx, { ...top, type: 'page' }, 'hei'))).toBe('hei')
    expect(await db.transaction((tx) => uniqueContentSlug(tx, { ...top, locale: 'en' }, 'hei'))).toBe('hei')
  })

  it('lets an item keep its own slug, and counts trashed items with their suffix', async () => {
    const top = { type: 'post', locale: 'nb', parentId: null }
    const own = await insert({ type: 'post', slug: 'egen' })
    expect(await db.transaction((tx) => uniqueContentSlug(tx, top, 'egen', own))).toBe('egen')
    await insert({ type: 'post', slug: 'kastet__trashed', status: 'trash' })
    expect(await db.transaction((tx) => uniqueContentSlug(tx, top, 'kastet'))).toBe('kastet')
    expect(await db.transaction((tx) => uniqueContentSlug(tx, top, 'kastet__trashed'))).toBe('kastet__trashed-2')
  })

  it('gives a reserved slug a number, and keeps a long slug within 200 characters', async () => {
    const pages = { type: 'page', locale: 'nb', parentId: null }
    expect(await db.transaction((tx) => uniqueContentSlug(tx, pages, 'feed'))).toBe('feed-2')
    expect(await db.transaction((tx) => uniqueContentSlug(tx, pages, '4'))).toBe('4-2')
    const long = 'x'.repeat(200)
    await insert({ slug: long })
    const next = await db.transaction((tx) => uniqueContentSlug(tx, pages, long))
    expect(next).toBe(`${'x'.repeat(198)}-2`)
  })

  it('moves the children of a deleted page to its parent, with a free slug', async () => {
    const grandparent = await insert({ slug: 'besteforelder' })
    const parent = await insert({ slug: 'forelder', parentId: grandparent })
    const child = await insert({ slug: 'barn', parentId: parent })
    await insert({ slug: 'barn', parentId: grandparent })
    const deleted = await db.transaction((tx) => deleteContentPermanently(tx, parent))
    expect(deleted).toMatchObject({ id: parent, slug: 'forelder' })
    const { rows } = await pool.query('select parent_id, slug from content where id = $1', [child])
    expect(rows[0]).toEqual({ parent_id: grandparent, slug: 'barn-2' })
    expect(await db.transaction((tx) => deleteContentPermanently(tx, parent))).toBeUndefined()
  })
})

/** A copy of the migrations folder with the journal cut after `count` entries. */
async function migrationsUpTo(count: number): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'toascribe-migrations-'))
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: unknown[] }
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }))
  return folder
}

describe.skipIf(TEST_DATABASE_URL === undefined)(
  '0007_content_api on a v0.6.0 database (needs TEST_DATABASE_URL)',
  () => {
    it('deletes the prototype drafts and keeps everything that only looks like one', async () => {
      const database = await createTestDatabase()
      const folder = await migrationsUpTo(7)
      const owner = new pg.Client({ connectionString: database.ownerUrl })
      try {
        await runMigrations({ connectionString: database.ownerUrl, logger, migrationsFolder: folder })
        await owner.connect()
        const account = async (name: string) =>
          (
            await owner.query<{ id: string }>(
              `insert into account (username, email, display_name, nicename, status)
             values ($1, $1 || '@example.test', $1, $1, 'active') returning id`,
              [name],
            )
          ).rows[0]?.id ?? ''
        const anna = await account('anna')
        const bo = await account('bo')
        const post = async (slug: string, title: string, author: string, status = 'draft') => {
          const id =
            (
              await owner.query<{ id: string }>(
                `insert into content (type, locale, slug, title, status, comment_status)
               values ('post', 'nb', $1, $2, $3, 'closed') returning id`,
                [slug, title, status],
              )
            ).rows[0]?.id ?? ''
          await owner.query('insert into content_author (content_id, account_id) values ($1, $2)', [id, author])
          return id
        }
        await post(`editor-prototype-${anna}`, 'Editor prototype', anna)
        await post(`editor-prototype-${bo}`, 'Editor prototype', bo)
        // Kept: someone else's slug, a changed title, a published item, an ordinary post.
        const foreign = await post(`editor-prototype-${anna}x`, 'Editor prototype', bo)
        const renamed = await post(`editor-prototype-${bo}-2`, 'Mitt innlegg', bo)
        const ordinary = await post('hei', 'Hei', anna)

        await runMigrations({ connectionString: database.ownerUrl, logger })

        const { rows } = await owner.query<{ id: string }>('select id from content order by slug')
        expect(rows.map((row) => row.id).sort()).toEqual([foreign, renamed, ordinary].sort())
        const authors = await owner.query('select count(*)::int as n from content_author')
        expect(authors.rows[0]).toEqual({ n: 3 })
      } finally {
        await owner.end().catch(() => undefined)
        await rm(folder, { recursive: true, force: true })
        await database.drop()
      }
    })
  },
)
