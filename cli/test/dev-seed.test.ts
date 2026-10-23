// `toa dev seed tom`: the guard (no database needed) and the reset itself (real PostgreSQL via TEST_DATABASE_URL).
import { execFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { CAPABILITIES, CORE_SETTINGS, CORE_SETTING_KEYS, DEFAULT_ROLES } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { devGuard } from '../src/commands/dev-seed.ts'
import { run, USAGE } from '../src/run.ts'
import {
  TEST_DATABASE_URL,
  createTestDatabase,
  memoryLogger,
  noticeIfSkipped,
  query,
  startConnectionProbe,
} from './helpers.ts'
import type { ConnectionProbe, TestDatabase } from './helpers.ts'

noticeIfSkipped('dev-seed')

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const ARGV = ['dev', 'seed', 'tom'] as const
const VERSION = '1.2.3'

interface Exec {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Runs the real entry point (src/index.ts through Node's type stripping) with exactly this environment. */
function execNode(args: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--conditions=source', ENTRY, ...args],
      { encoding: 'utf8', env, timeout: 15_000 },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
      },
    )
  })
}

describe('the guard', () => {
  let probe: ConnectionProbe

  beforeAll(async () => {
    probe = await startConnectionProbe()
  })
  afterAll(async () => {
    await probe.close()
  })

  it.each([
    ['production', { NODE_ENV: 'production' }, 'NODE_ENV is "production"'],
    ['unset', {}, 'NODE_ENV is not set'],
    ['empty', { NODE_ENV: '' }, 'NODE_ENV is ""'],
    ['unknown', { NODE_ENV: 'staging' }, 'NODE_ENV is "staging"'],
    ['wrong case', { NODE_ENV: 'Development' }, 'NODE_ENV is "Development"'],
  ])('refuses with NODE_ENV %s and makes no connection', async (_label, nodeEnv, message) => {
    const { logger, lines } = memoryLogger()
    const result = await run([...ARGV], VERSION, { env: { ...nodeEnv, MIGRATION_DATABASE_URL: probe.url }, logger })
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Refusing to reset the database')
    expect(result.stderr).toContain(message)
    expect(result.stderr).not.toMatch(/ECONNREFUSED|ECONNRESET|connect/i)
    expect(result.stderr).not.toContain('probe-secret-pw')
    expect(lines).toEqual([])
    expect(probe.connections()).toBe(0)
  })

  it('refuses before the configuration is read, so a missing MIGRATION_DATABASE_URL does not matter', async () => {
    const result = await run([...ARGV], VERSION, { env: { NODE_ENV: 'production' } })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('Refusing to reset the database')
    expect(result.stderr).not.toContain('MIGRATION_DATABASE_URL')
  })

  it('devGuard allows exactly development and test', () => {
    expect(devGuard('development')).toBeUndefined()
    expect(devGuard('test')).toBeUndefined()
    for (const value of ['production', undefined, '', 'prod', 'dev', 'Test', ' test']) {
      expect(devGuard(value)).toContain('Refusing')
    }
  })

  it('does connect under NODE_ENV=test: the probe would have seen a connection (control)', async () => {
    const before = probe.connections()
    const { logger } = memoryLogger()
    const result = await run([...ARGV], VERSION, {
      env: { NODE_ENV: 'test', MIGRATION_DATABASE_URL: probe.url },
      logger,
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('dev seed tom failed; see the log above\n')
    expect(probe.connections()).toBeGreaterThan(before)
  })

  it('refuses in the real entry point, with the exit code, and leaks no secret', async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV'))
    for (const nodeEnv of [{ NODE_ENV: 'production' }, {}]) {
      const before = probe.connections()
      // Asynchronous: the probe lives in this process, so a blocking spawn would stop it from ever answering.
      const child = await execNode([...ARGV], { ...env, ...nodeEnv, MIGRATION_DATABASE_URL: probe.url })
      await new Promise((resolve) => setImmediate(resolve)) // let the probe see a connection that was made
      expect(child.code).toBe(2)
      expect(child.stderr).toContain('Refusing to reset the database')
      expect(child.stdout + child.stderr).not.toContain('probe-secret-pw')
      expect(probe.connections()).toBe(before)
    }
  })

  it('names the variable, never its value, when MIGRATION_DATABASE_URL is missing or not a postgres URL', async () => {
    const missing = await run([...ARGV], VERSION, { env: { NODE_ENV: 'development' } })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('MIGRATION_DATABASE_URL')

    const bad = await run([...ARGV], VERSION, {
      env: { NODE_ENV: 'development', MIGRATION_DATABASE_URL: 'mysql://u:hunter2@h/db' },
    })
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('MIGRATION_DATABASE_URL')
    expect(bad.stderr).not.toContain('hunter2')
  })
})

describe('the command line', () => {
  it('says the other fixtures are not available yet and exits 2', async () => {
    for (const fixture of ['blogg', 'stor', 'butikk']) {
      const result = await run(['dev', 'seed', fixture], VERSION)
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`"${fixture}" is not available yet`)
    }
  })

  it('prints the usage and exits 2 for an unknown fixture or an incomplete command', async () => {
    for (const argv of [
      ['dev'],
      ['dev', 'seed'],
      ['dev', 'seed', 'nope'],
      ['dev', 'seed', 'tom', 'extra'],
      ['dev', 'reset'],
    ]) {
      expect(await run(argv, VERSION)).toEqual({ code: 2, stdout: '', stderr: USAGE })
    }
  })

  it('the usage text names the command and the guard', () => {
    expect(USAGE).toContain('dev seed tom')
    expect(USAGE).toContain('NODE_ENV')
  })

  it('toa --version still needs no environment', () => {
    const child = spawnSync(process.execPath, ['--conditions=source', ENTRY, '--version'], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '' },
    })
    expect(child.status).toBe(0)
    expect(child.stdout).toMatch(/^\d+\.\d+\.\d+/)
    expect(child.stderr).toBe('')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('toa dev seed tom against PostgreSQL', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase()
  })
  afterAll(async () => {
    await db.drop()
  })

  async function seedTom(nodeEnv = 'development') {
    const log = memoryLogger()
    const result = await run([...ARGV], VERSION, {
      env: { NODE_ENV: nodeEnv, MIGRATION_DATABASE_URL: db.url },
      logger: log.logger,
    })
    return { result, ...log }
  }

  const count = async (table: string): Promise<number> =>
    Number((await query<{ n: string }>(db.url, `select count(*) as n from ${table}`))[0]?.n)

  it('works on an empty database: creates the schema, the five roles and the default settings', async () => {
    expect(await query(db.url, "select 1 from pg_tables where schemaname = 'public'")).toEqual([])

    const { result, lines } = await seedTom('test')
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' })

    expect(await count('role')).toBe(5)
    expect(await count('setting')).toBe(CORE_SETTING_KEYS.length)
    expect(await count('account')).toBe(0)
    expect(await count('content')).toBe(0)
    const done = lines.find((line) => line['msg'] === 'tables emptied and core roles and settings seeded')
    expect(done).toMatchObject({ roles: 5, settings: CORE_SETTING_KEYS.length })
    expect(done?.['tables']).toBeGreaterThan(20)
  })

  it('empties accounts and content, restores roles, settings and identity, and leaves drizzle and pgboss alone', async () => {
    await seedTom()
    // Rows a developer would have made.
    await query(
      db.url,
      `insert into account (username, email, display_name, nicename, status)
       values ('tor', 'tor@example.com', 'Tor', 'tor', 'active')`,
    )
    for (const slug of ['one', 'two', 'three']) {
      await query(
        db.url,
        `insert into content (type, locale, slug, status, comment_status) values ('post', 'nb', $1, 'draft', 'open')`,
        [slug],
      )
    }
    expect(
      (await query<{ short_id: string }>(db.url, 'select max(short_id) as short_id from content'))[0]?.short_id,
    ).toBe('3')
    await query(db.url, `update setting set value = '"Mine"'::jsonb where key = 'blogname'`)
    await query(db.url, `update setting set value = '99'::jsonb where key = 'posts_per_page'`)
    await query(db.url, `update role set capabilities = '{}' where slug = 'editor'`)
    await query(db.url, `delete from role where slug = 'subscriber'`)

    const migrationsBefore = await query(db.url, 'select * from drizzle.__drizzle_migrations order by id')
    const pgbossBefore = await query(db.url, 'select * from pgboss.version')
    expect(migrationsBefore.length).toBeGreaterThan(0)
    expect(pgbossBefore.length).toBe(1)
    // A queue of the app's own must survive: pgboss.* is not touched.
    await query(db.url, `select pgboss.create_queue('cli-test-queue', '{"policy":"standard"}'::jsonb)`)
    const pgbossQueues = await query(db.url, 'select name from pgboss.queue order by name')
    expect(pgbossQueues).toEqual([{ name: 'cli-test-queue' }])

    const { result } = await seedTom()
    expect(result.code).toBe(0)

    expect(await count('account')).toBe(0)
    expect(await count('content')).toBe(0)

    const roles = await query<{ slug: string; capabilities: string[] }>(
      db.url,
      'select slug, capabilities from role order by slug',
    )
    expect(roles.map((r) => r.slug)).toEqual(DEFAULT_ROLES.map((r) => r.slug).sort())
    for (const defaults of DEFAULT_ROLES) {
      expect(roles.find((r) => r.slug === defaults.slug)?.capabilities.sort()).toEqual(
        [...defaults.capabilities].sort(),
      )
    }
    expect(roles.find((r) => r.slug === 'administrator')?.capabilities).toHaveLength(CAPABILITIES.length)

    const settings = await query<{ key: string; value: unknown }>(db.url, 'select key, value from setting')
    expect(settings).toHaveLength(CORE_SETTING_KEYS.length)
    for (const key of CORE_SETTING_KEYS) {
      expect(settings.find((s) => s.key === key)?.value).toEqual(CORE_SETTINGS[key])
    }

    // The identity restarted.
    await query(
      db.url,
      `insert into content (type, locale, slug, status, comment_status) values ('post', 'nb', 'fresh', 'draft', 'open')`,
    )
    expect((await query<{ short_id: string }>(db.url, 'select short_id from content'))[0]?.short_id).toBe('1')

    expect(await query(db.url, 'select * from drizzle.__drizzle_migrations order by id')).toEqual(migrationsBefore)
    expect(await query(db.url, 'select * from pgboss.version')).toEqual(pgbossBefore)
    expect(await query(db.url, 'select name from pgboss.queue order by name')).toEqual(pgbossQueues)
  })

  it('is idempotent: a second run ends in the same state', async () => {
    expect((await seedTom()).result.code).toBe(0)
    expect((await seedTom()).result.code).toBe(0)
    expect(await count('role')).toBe(5)
    expect(await count('setting')).toBe(CORE_SETTING_KEYS.length)
  })

  it('rolls back if the seed fails: nothing is emptied', async () => {
    await seedTom()
    await query(
      db.url,
      `insert into account (username, email, display_name, nicename, status)
       values ('keep', 'keep@example.com', 'Keep', 'keep', 'active')`,
    )
    // A trigger that fails the seed's insert into setting, but only when the table is empty: that is the case after the
    // TRUNCATE in the same transaction, so the rollback is what keeps the account. (The seed that ends runMigrations
    // inserts into a full table and passes.)
    await query(
      db.url,
      `create function public.cli_test_fail() returns trigger language plpgsql as $$
         begin
           if not exists (select 1 from setting) then raise exception 'no settings'; end if;
           return new;
         end $$`,
    )
    await query(
      db.url,
      'create trigger cli_test_fail before insert on setting for each row execute function public.cli_test_fail()',
    )
    try {
      const { result } = await seedTom()
      expect(result.code).toBe(1)
      expect(await count('account')).toBe(1)
    } finally {
      await query(db.url, 'drop trigger cli_test_fail on setting')
      await query(db.url, 'drop function public.cli_test_fail()')
    }
  })

  it('does not run under production, and the database is left as it was', async () => {
    await seedTom()
    await query(
      db.url,
      `insert into account (username, email, display_name, nicename, status)
       values ('prod', 'prod@example.com', 'Prod', 'prod', 'active')`,
    )
    const { result } = await seedTom('production')
    expect(result.code).toBe(2)
    expect(await count('account')).toBe(1)
  })
})
