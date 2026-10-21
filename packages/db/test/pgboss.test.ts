// pg-boss as the app role, with PGBOSS_APP_OPTIONS: works with DML only, and never needs DDL.
import { PgBoss } from 'pg-boss'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PGBOSS_APP_OPTIONS } from '../src/pgboss.ts'
import { runMigrations } from '../src/migrator.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('pgboss')

describe.skipIf(TEST_DATABASE_URL === undefined)('pg-boss as the app role (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.drop()
  })

  it('refuses to start before the migration step has installed the schema', async () => {
    const boss = new PgBoss({ ...PGBOSS_APP_OPTIONS, connectionString: database.appUrl })
    boss.on('error', () => undefined)
    await expect(boss.start()).rejects.toThrow('pg-boss is not installed')
    await boss.stop({ graceful: false })
  })

  it('creates queues, sends, fetches, completes and supervises with DML only', async () => {
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })

    const errors: unknown[] = []
    const boss = new PgBoss({ ...PGBOSS_APP_OPTIONS, connectionString: database.appUrl })
    boss.on('error', (err) => errors.push(err))
    await boss.start()
    try {
      await boss.createQueue('m01-smoke')
      const id = await boss.send('m01-smoke', { hello: 'world' })
      expect(id).toEqual(expect.any(String))

      const [job] = await boss.fetch<{ hello: string }>('m01-smoke')
      expect(job?.data).toEqual({ hello: 'world' })
      if (job === undefined) {
        throw new Error('no job fetched')
      }
      await boss.complete('m01-smoke', job.id)

      // The maintenance pass the worker's supervisor runs: retention, monitoring, bloat detection.
      await boss.supervise()

      // DDL stays out of reach: a queue with its own table (partition: true) is refused.
      expect(await sqlState(boss.createQueue('m01-partitioned', { partition: true }))).toBe('42501')
    } finally {
      await boss.stop({ graceful: false })
    }
    expect(errors).toEqual([])
  })
})
