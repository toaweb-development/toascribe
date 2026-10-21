// The migration runner: Drizzle migrations plus the pg-boss schema, as the owner role, under the lock.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MIGRATIONS_FOLDER, MIGRATION_LOCK_KEY, runMigrations } from '../src/migrator.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, queryAs } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('migrate')

const ENTRY = fileURLToPath(new URL('../src/migrate.ts', import.meta.url))
const logger = pino({ level: 'silent' })

interface Run {
  readonly code: number | null
  readonly output: string
}

/** Runs the real entry point (src/migrate.ts through Node's type stripping) with the given env. */
function runEntry(env: Readonly<Record<string, string>>): Promise<Run> {
  return new Promise((resolve, reject) => {
    // Only the env given here reaches the runner, so a MIGRATION_DATABASE_URL in the shell cannot leak in.
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'MIGRATION_DATABASE_URL'))
    const child = spawn(process.execPath, [ENTRY], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({ code, output })
    })
  })
}

/** How many migrations the committed journal lists: the runner must apply each one. */
async function journalEntries(): Promise<number> {
  const journal: unknown = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'))
  const entries = typeof journal === 'object' && journal !== null && 'entries' in journal ? journal.entries : undefined
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('migrations/meta/_journal.json lists no migrations')
  }
  return entries.length
}

async function pgBossVersion(url: string): Promise<number> {
  const rows = await queryAs<{ version: number }>(url, 'select version from pgboss.version')
  return rows[0]?.version ?? Number.NaN
}

describe.skipIf(TEST_DATABASE_URL === undefined)('migration runner (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.drop()
  })

  it('succeeds on an empty database through the entry point, and again (idempotent)', async () => {
    const first = await runEntry({ MIGRATION_DATABASE_URL: database.ownerUrl })
    expect(first.output).toContain('migrations complete')
    expect(first.code).toBe(0)

    const version = await pgBossVersion(database.ownerUrl)
    expect(version).toBeGreaterThan(0)
    expect(await queryAs(database.ownerUrl, 'select count(*)::int as n from drizzle.__drizzle_migrations')).toEqual([
      { n: await journalEntries() },
    ])

    const second = await runEntry({ MIGRATION_DATABASE_URL: database.ownerUrl })
    expect(second.output).toContain('already at version')
    expect(second.code).toBe(0)
    expect(await pgBossVersion(database.ownerUrl)).toBe(version)
  })

  it('leaves every pgboss, drizzle and public object owned by the owner role', async () => {
    const owners = await queryAs<{ owner: string }>(
      database.adminUrl,
      `select distinct pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('pgboss', 'drizzle', 'public')`,
    )
    expect(owners).toEqual([{ owner: 'toascribe_owner' }])
  })

  it('waits while another session holds the migration lock, then runs and releases it', async () => {
    const holder = new pg.Client({ connectionString: database.ownerUrl })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY])
      let finished = false
      const run = runMigrations({ connectionString: database.ownerUrl, logger }).then(() => {
        finished = true
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(finished).toBe(false)

      await holder.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY])
      await run
      expect(finished).toBe(true)
    } finally {
      await holder.end()
    }

    await Promise.all([
      runMigrations({ connectionString: database.ownerUrl, logger }),
      runMigrations({ connectionString: database.ownerUrl, logger }),
    ])
    const held = await queryAs<{ n: number }>(
      database.adminUrl,
      `select count(*)::int as n from pg_locks
        where locktype = 'advisory' and ((classid::bigint << 32) | objid::bigint) = $1`,
      [MIGRATION_LOCK_KEY],
    )
    expect(held).toEqual([{ n: 0 }])
  })

  it('exits non-zero without MIGRATION_DATABASE_URL, and with a wrong password, without logging the URL', async () => {
    const missing = await runEntry({})
    expect(missing.code).toBe(1)
    expect(missing.output).toContain('MIGRATION_DATABASE_URL')

    const wrong = new URL(database.ownerUrl)
    wrong.password = 'not-the-password'
    const refused = await runEntry({ MIGRATION_DATABASE_URL: wrong.toString() })
    expect(refused.code).toBe(1)
    expect(refused.output).toContain('migration failed')
    expect(refused.output).not.toContain('not-the-password')
  })
})
