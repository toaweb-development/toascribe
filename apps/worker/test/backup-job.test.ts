// The daily backup (M1.7): off without toascribe.toml or with schedule = false; on, one backup as the app role, the oldest pruned
// to [backup] keep, and the status recorded for Nettstedshelse.
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMigrations } from '@toascribe/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dailyBackupOn, runDailyBackup } from '../src/jobs/backup.ts'
import pg from 'pg'

import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('daily backup')
const logger = pino({ level: 'silent' })

describe('dailyBackupOn', () => {
  it('is off without the file, or with schedule = false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'toascribe-job-'))
    try {
      expect(dailyBackupOn({ configFile: join(dir, 'none.toml'), logger })).toBe(false)
      await writeFile(join(dir, 'a.toml'), '[backup]\nschedule = false\n')
      expect(dailyBackupOn({ configFile: join(dir, 'a.toml'), logger })).toBe(false)
      await writeFile(join(dir, 'b.toml'), '[backup]\nschedule = true\n')
      expect(dailyBackupOn({ configFile: join(dir, 'b.toml'), logger })).toBe(true)
      await writeFile(join(dir, 'c.toml'), '[backup\n')
      expect(dailyBackupOn({ configFile: join(dir, 'c.toml'), logger })).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('runDailyBackup (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let dir: string

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger })
    dir = await mkdtemp(join(tmpdir(), 'toascribe-job-'))
    await mkdir(join(dir, 'uploads'), { recursive: true })
    await mkdir(join(dir, 'backups'), { recursive: true })
    for (const day of ['20', '21', '22']) {
      await writeFile(join(dir, 'backups', `toascribe-202610${day}-033000Z-0.6.0.tar.zst`), 'old')
    }
    await writeFile(join(dir, 'toascribe.toml'), '[backup]\nschedule = true\nkeep = 2\n')
  })

  afterAll(async () => {
    await database.drop()
    await rm(dir, { recursive: true, force: true })
  })

  it('makes a backup as the app role, keeps the newest two, and records the status', async () => {
    await runDailyBackup({
      databaseUrl: database.appUrl,
      uploadsDir: join(dir, 'uploads'),
      backupsDir: join(dir, 'backups'),
      configFile: join(dir, 'toascribe.toml'),
      version: '0.6.0',
      logger,
      now: () => new Date('2026-10-28T03:30:00Z'),
    })
    expect((await readdir(join(dir, 'backups'))).sort()).toEqual([
      'toascribe-20261022-033000Z-0.6.0.tar.zst',
      'toascribe-20261028-033000Z-0.6.0.tar.zst',
    ])
    const client = new pg.Client({ connectionString: database.ownerUrl })
    await client.connect()
    const status = (
      await client
        .query<{ value: { ok: boolean; scheduled: boolean } }>(`select value from setting where key = 'backup_status'`)
        .finally(() => client.end())
    ).rows[0]?.value
    expect(status).toMatchObject({ ok: true, scheduled: true })
  })
})
