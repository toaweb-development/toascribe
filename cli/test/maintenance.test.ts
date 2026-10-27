// `toa maintenance` (M1.7, K-266, K-288): usage errors are exit 2; on, status and off against a migrated database, each change with
// an audit entry by the CLI and a cache change for the site.
import { runMigrations } from '@toascribe/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped, query } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('maintenance')

describe('toa maintenance', () => {
  it('refuses an unknown action and bad flags with exit 2', async () => {
    for (const argv of [
      ['maintenance'],
      ['maintenance', 'kanskje'],
      ['maintenance', 'on', '--retry-after', '5'],
      ['maintenance', 'on', '--retry-after', 'snart'],
      ['maintenance', 'on', '--message', 'x'.repeat(501)],
      ['maintenance', 'off', '--message', 'x'],
      ['maintenance', 'status', '--format', 'xml'],
    ]) {
      const result = await run(argv, '1.2.3', { env: {}, logger: memoryLogger().logger })
      expect(result.code, argv.join(' ')).toBe(2)
    }
  })

  describe.skipIf(TEST_DATABASE_URL === undefined)('against a database (needs TEST_DATABASE_URL)', () => {
    let database: TestDatabase
    const cli = (argv: string[]) =>
      run(['maintenance', ...argv], '1.2.3', { env: { DATABASE_URL: database.url }, logger: memoryLogger().logger })

    beforeAll(async () => {
      database = await createTestDatabase()
      await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    })
    afterAll(async () => {
      await database.drop()
    })

    it('turns it on with a message, reports it, and turns it off, with audit entries and cache changes', async () => {
      expect((await cli(['status'])).stdout).toBe('Maintenance mode is off.\n')
      const on = await cli(['on', '--message', 'Tilbake kl. 12', '--retry-after', '120'])
      expect(on.code).toBe(0)
      const status = JSON.parse((await cli(['status', '--format', 'json'])).stdout) as Record<string, unknown>
      expect(status).toMatchObject({ enabled: true, message: 'Tilbake kl. 12', retryAfter: 120 })
      expect(typeof status['since']).toBe('string')
      expect((await cli(['off'])).code).toBe(0)
      expect(JSON.parse((await cli(['status', '--format', 'json'])).stdout)).toMatchObject({
        enabled: false,
        since: null,
      })

      // A new turn on does not bring back the last message or wait.
      expect((await cli(['on'])).code).toBe(0)
      expect(JSON.parse((await cli(['status', '--format', 'json'])).stdout)).toMatchObject({
        enabled: true,
        message: '',
        retryAfter: 600,
      })
      expect((await cli(['off'])).code).toBe(0)

      const audit = await query<{ action: string; actor: string; source: string }>(
        database.url,
        `select action, actor, source from audit_log where object_id = 'maintenance_mode' order by id`,
      )
      expect(audit).toEqual([
        { action: 'maintenance.enabled', actor: 'cli', source: 'cli' },
        { action: 'maintenance.disabled', actor: 'cli', source: 'cli' },
        { action: 'maintenance.enabled', actor: 'cli', source: 'cli' },
        { action: 'maintenance.disabled', actor: 'cli', source: 'cli' },
      ])
      const changes = await query<{ n: string }>(
        database.url,
        `select count(*) as n from cache_invalidation where tag = '*'`,
      )
      expect(Number(changes[0]?.n)).toBeGreaterThanOrEqual(2)
    })
  })
})
