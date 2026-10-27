// `toa check-update` (M1.7, K-290, K-261) against a source in memory, never the network: usage errors are exit 2; it stores the
// answer and says whether a release is newer; off on the server or by the setting it asks nothing (exit 1); a failure is exit 1
// with the reason.
import { runMigrations } from '@toascribe/db'
import type { UpdateSource } from '@toascribe/updates'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped, query } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('check-update')

let asked = 0
const releases = (tags: string[]): UpdateSource => ({
  tags: () => {
    asked += 1
    return Promise.resolve(tags)
  },
})

describe('toa check-update: usage', () => {
  it.each([[['check-update', '--format', 'xml']], [['check-update', '--now']], [['core', 'check-update', 'x']]])(
    '%j is exit 2',
    async (argv) => {
      const result = await run(argv, '0.6.0', { env: {}, logger: memoryLogger().logger, updateSource: releases([]) })
      expect(result.code).toBe(2)
    },
  )
})

describe.skipIf(TEST_DATABASE_URL === undefined)(
  'toa check-update against a database (needs TEST_DATABASE_URL)',
  () => {
    let database: TestDatabase
    const cli = (argv: string[], source: UpdateSource, extra: Record<string, string> = {}) =>
      run(argv, '0.6.0', {
        env: { DATABASE_URL: database.url, ...extra },
        logger: memoryLogger().logger,
        updateSource: source,
      })

    beforeAll(async () => {
      database = await createTestDatabase()
      await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    })

    afterAll(async () => {
      await database.drop()
    })

    it('stores the newest release and says it is out', async () => {
      const result = await cli(['check-update'], releases(['0.6.0', '0.7.0', '0.8.0-rc.1', 'latest']))
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toBe(
        'toascribe 0.7.0 is out; this is 0.6.0. On the host: docker compose pull && docker compose up -d\n',
      )
      const [row] = await query<{ value: { latest: string } }>(
        database.url,
        `select value from setting where key = 'update_status'`,
      )
      expect(row?.value.latest).toBe('0.7.0')
      const json = await cli(['core', 'check-update', '--format', 'json'], releases(['0.6.0']))
      expect(JSON.parse(json.stdout)).toMatchObject({ current: '0.6.0', latest: '0.6.0', available: false, ok: true })
      const audit = await query<{ actor: string }>(
        database.url,
        `select actor from audit_log where action = 'updates.checked'`,
      )
      expect(audit).toEqual([{ actor: 'cli' }, { actor: 'cli' }])
    })

    it('reports a failure with its reason, exit 1', async () => {
      const result = await cli(['check-update'], { tags: () => Promise.reject(new Error('the registry answered 503')) })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('the registry answered 503')
    })

    it('asks nothing when the server or the setting turns it off', async () => {
      asked = 0
      const server = await cli(['check-update'], releases(['9.9.9']), { TOASCRIBE_UPDATE_CHECK: 'off' })
      expect(server.code).toBe(1)
      expect(server.stderr).toContain('TOASCRIBE_UPDATE_CHECK=off')
      await query(database.url, `update setting set value = 'false'::jsonb where key = 'update_check'`)
      const setting = await cli(['check-update'], releases(['9.9.9']))
      expect(setting.code).toBe(1)
      expect(asked).toBe(0)
      expect((await cli(['check-update'], releases([]), { TOASCRIBE_UPDATE_CHECK: 'maybe' })).code).toBe(2)
    })
  },
)
