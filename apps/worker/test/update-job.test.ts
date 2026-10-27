// The daily update check (M1.7, K-290) against a source in memory, never the network: it stores the newest release; with the
// `update_check` setting off or TOASCRIBE_UPDATE_CHECK=off the source is never asked; a check older than a day is due.
import { createDb, runMigrations } from '@toascribe/db'
import type { UpdateSource } from '@toascribe/updates'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runDailyUpdateCheck, updateCheckDue } from '../src/jobs/updates.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('update check')
const logger = pino({ level: 'silent' })

describe.skipIf(TEST_DATABASE_URL === undefined)('runDailyUpdateCheck (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let handle: ReturnType<typeof createDb>
  let asked = 0
  const source: UpdateSource = {
    tags: () => {
      asked += 1
      return Promise.resolve(['0.5.0', '0.6.0', '0.7.0', '0.8.0-rc.1', 'latest'])
    },
  }
  const owner = async (sql: string) => {
    const client = new pg.Client({ connectionString: database.ownerUrl })
    await client.connect()
    try {
      return (await client.query<{ value: unknown }>(sql)).rows
    } finally {
      await client.end()
    }
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger })
    handle = createDb({ connectionString: database.appUrl, max: 1 })
  })

  afterAll(async () => {
    await handle.pool.end()
    await database.drop()
  })

  it('stores the newest release, and is due again after a day', async () => {
    const now = new Date('2026-10-28T04:41:00Z')
    expect(await updateCheckDue(handle.db, now)).toBe(true)
    await runDailyUpdateCheck({ db: handle.db, logger, version: '0.6.0', serverAllows: true, source, now: () => now })
    expect(asked).toBe(1)
    const [row] = await owner(`select value from setting where key = 'update_status'`)
    expect(row?.value).toEqual({
      checkedAt: now.toISOString(),
      current: '0.6.0',
      latest: '0.7.0',
      ok: true,
      error: null,
    })
    expect(await updateCheckDue(handle.db, new Date('2026-10-28T12:00:00Z'))).toBe(false)
    expect(await updateCheckDue(handle.db, new Date('2026-10-29T05:00:00Z'))).toBe(true)
  })

  it('asks nothing when the server or the setting turns it off', async () => {
    asked = 0
    await runDailyUpdateCheck({ db: handle.db, logger, version: '0.6.0', serverAllows: false, source })
    await owner(`update setting set value = 'false'::jsonb where key = 'update_check'`)
    await runDailyUpdateCheck({ db: handle.db, logger, version: '0.6.0', serverAllows: true, source })
    expect(asked).toBe(0)
  })
})
