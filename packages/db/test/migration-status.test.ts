// getMigrationStatus() as the app role (migration 0006 lets it read the migrator's table), and the `setup` login-attempt action.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getMigrationStatus, readMigrationJournal } from '../src/migration-status.ts'
import { runMigrations } from '../src/migrator.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('migration-status')

describe.skipIf(TEST_DATABASE_URL === undefined)('migration status (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let app: pg.Pool
  let owner: pg.Pool

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })
    app = new pg.Pool({ connectionString: database.appUrl, max: 2 })
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
  })

  afterAll(async () => {
    await Promise.all([app.end(), owner.end()])
    await database.drop()
  })

  it('says a fully migrated database is up to date, as the app role', async () => {
    const journal = readMigrationJournal()
    const status = await getMigrationStatus(drizzle({ client: app }))
    expect(status).toEqual({
      upToDate: true,
      applied: journal.length,
      expected: journal.length,
      latest: journal.at(-1)?.tag,
    })
    expect(status.latest).toBe('0013_global_set_blocks')
  })

  it('says a database that lacks the newest migration is not up to date', async () => {
    // A journal from a newer build than the database: one entry more than the database has, later than any applied.
    const dir = await mkdtemp(join(tmpdir(), 'toascribe-journal-'))
    try {
      await mkdir(join(dir, 'meta'))
      const entries = [...readMigrationJournal(), { tag: '0099_newer', when: Date.now() + 86_400_000 }]
      await writeFile(join(dir, 'meta', '_journal.json'), JSON.stringify({ entries }))
      const status = await getMigrationStatus(drizzle({ client: app }), dir)
      expect(status.upToDate).toBe(false)
      expect(status.latest).toBe('0099_newer')
      expect(status.applied).toBe(entries.length - 1)
      expect(status.expected).toBe(entries.length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('gives the app role read access to that one table and nothing to change in the schema', async () => {
    expect(await sqlState(app.query('select count(*) from drizzle.__drizzle_migrations'))).toBeUndefined()
    expect(await sqlState(app.query('delete from drizzle.__drizzle_migrations'))).toBe('42501')
    expect(await sqlState(app.query('create table drizzle.sneaky (id int)'))).toBe('42501')
  })

  it('accepts the `setup` action in login_attempt, and still refuses an unknown one', async () => {
    expect(
      await sqlState(owner.query(`insert into login_attempt (action, ip) values ('setup', '192.0.2.1')`)),
    ).toBeUndefined()
    expect(await sqlState(owner.query(`insert into login_attempt (action, ip) values ('nonsense', '192.0.2.1')`))).toBe(
      '23514',
    )
  })
})
