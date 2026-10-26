// `toa media regenerate`: the arguments, and the command against a real, migrated PostgreSQL (TEST_DATABASE_URL): the images are marked
// pending and one job per image is queued for the worker.
import { runMigrations } from '@toascribe/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped, query } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('media')

describe('toa media regenerate', () => {
  it('refuses an --id that is not an id, and unknown flags', async () => {
    for (const argv of [
      ['media', 'regenerate', '--id', 'x'],
      ['media', 'regenerate', '--all'],
    ]) {
      const result = await run(argv, '1.2.3', { env: {}, logger: memoryLogger().logger })
      expect(result.code, argv.join(' ')).toBe(2)
    }
  })

  describe.skipIf(TEST_DATABASE_URL === undefined)('against a database (needs TEST_DATABASE_URL)', () => {
    let database: TestDatabase

    beforeAll(async () => {
      database = await createTestDatabase()
      await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    })
    afterAll(async () => {
      await database.drop()
    })

    it('marks the images pending, queues a job each, and leaves other files alone', async () => {
      const sha = 'a'.repeat(64)
      const rows = await query<{ id: string; mime: string }>(
        database.url,
        `insert into media (mime, size, sha256, storage_key) values
           ('image/jpeg', 1, $1, '2026/10/a-00000001.jpg'), ('image/png', 1, $1, '2026/10/b-00000002.png'),
           ('application/pdf', 1, $1, '2026/10/c-00000003.pdf')
         returning id, mime`,
        [sha],
      )
      const result = await run(['media', 'regenerate'], '1.2.3', {
        env: { DATABASE_URL: database.url },
        logger: memoryLogger().logger,
      })
      expect(result).toMatchObject({ code: 0, stdout: '2 image(s) queued for new sizes. The worker makes them.\n' })
      const states = await query<{ mime: string; processing: string }>(
        database.url,
        'select mime, processing from media order by mime',
      )
      expect(states).toEqual([
        { mime: 'application/pdf', processing: 'ready' },
        { mime: 'image/jpeg', processing: 'pending' },
        { mime: 'image/png', processing: 'pending' },
      ])
      const jobs = await query<{ data: { kind: string; mediaId: string } }>(
        database.url,
        `select data from pgboss.job where name = 'media.process' order by created_on`,
      )
      const images = rows.filter((row) => row.mime.startsWith('image/')).map((row) => row.id)
      expect(jobs.map((job) => job.data).sort((a, b) => a.mediaId.localeCompare(b.mediaId))).toEqual(
        images.map((mediaId) => ({ kind: 'regenerate', mediaId })).sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
      )
      const one = await run(['media', 'regenerate', '--id', '01a15f9a-26a2-73d3-8aad-c6b671836b33'], '1.2.3', {
        env: { DATABASE_URL: database.url },
        logger: memoryLogger().logger,
      })
      expect(one.code).toBe(1)
    })
  })
})
