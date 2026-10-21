// Test helpers for the database tests of the cli (typescript §6): a throwaway database per test file on a disposable
// server. TEST_DATABASE_URL must be a superuser URL on that server, for example
//   TEST_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/postgres
// The cli tests create no PostgreSQL roles, so the superuser's own URL stands in for the owner role's
// MIGRATION_DATABASE_URL; the reset and the migrations work the same for any role that owns the tables. The db and
// worker tests do create the cluster-wide roles and run in parallel with these on the same server, so
// createTestDatabase() takes the server-wide role lock (see ROLE_LOCK_KEY): while a cli database exists, no
// toascribe_* role does, and the migrations run here without their role grants. Without TEST_DATABASE_URL the suites
// skip and say so.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

import pg from 'pg'
import { pino } from 'pino'

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export const SKIP_REASON = 'skipped: set TEST_DATABASE_URL to a superuser URL on a disposable PostgreSQL 18 server'

/** Writes a visible notice when the database tests cannot run. */
export function noticeIfSkipped(suite: string): void {
  if (TEST_DATABASE_URL === undefined) {
    process.stderr.write(`[${suite}] ${SKIP_REASON}\n`)
  }
}

export interface TestDatabase {
  readonly name: string
  /** Superuser URL of the throwaway database: what the tests pass as MIGRATION_DATABASE_URL. */
  readonly url: string
  readonly drop: () => Promise<void>
}

function urlFor(base: string, database: string): string {
  const url = new URL(base)
  url.pathname = `/${database}`
  return url.toString()
}

async function withClient<T>(connectionString: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Server-wide advisory lock for cross-package isolation of the cluster-wide roles toascribe_owner and toascribe_app.
 * The db, worker and cli tests run in parallel on one server; the first two create and drop those roles, and the
 * migrations grant to them when they exist, so any test database that lives while another package's roles exist would
 * make that package's `drop role` fail. Every helper takes this lock (same key in packages/db, apps/worker and cli) in
 * createTestDatabase() and releases it when that database is dropped. Do not change the key in one helper only.
 *
 * It is a session lock on a dedicated connection to the base database (advisory locks are per database, and all
 * helpers use TEST_DATABASE_URL's), so it also goes away if the test process dies. Re-entrant within one process
 * (one test file): a second database created while the first is alive shares the connection instead of deadlocking.
 */
const ROLE_LOCK_KEY = 7_410_202_610

interface RoleLock {
  holders: number
  readonly client: pg.Client
  readonly ready: Promise<void>
}

let roleLock: RoleLock | undefined

async function acquireRoleLock(base: string): Promise<RoleLock> {
  if (roleLock === undefined) {
    const client = new pg.Client({ connectionString: base })
    const ready = client.connect().then(async () => {
      await client.query('select pg_advisory_lock($1)', [ROLE_LOCK_KEY])
    })
    roleLock = { holders: 0, client, ready }
  }
  const lock = roleLock
  lock.holders += 1
  try {
    await lock.ready
    return lock
  } catch (err) {
    await releaseRoleLock(lock)
    throw err
  }
}

async function releaseRoleLock(lock: RoleLock): Promise<void> {
  lock.holders -= 1
  if (lock.holders > 0) {
    return
  }
  if (roleLock === lock) {
    roleLock = undefined
  }
  try {
    await lock.client.query('select pg_advisory_unlock($1)', [ROLE_LOCK_KEY])
  } catch {
    // A failed connection has already lost the lock; ending it below is all that is left to do.
  } finally {
    await lock.client.end().catch(() => undefined)
  }
}

/** Creates an empty database (no tables, no schema objects) with a random name. */
async function createUnlockedTestDatabase(base: string): Promise<TestDatabase> {
  const name = `toascribe_cli_test_${randomBytes(4).toString('hex')}`
  await withClient(base, async (admin) => {
    const { rows } = await admin.query<{ super: boolean }>(
      'select rolsuper as super from pg_roles where rolname = current_user',
    )
    if (rows[0]?.super !== true) {
      throw new Error('TEST_DATABASE_URL must connect as a superuser')
    }
    await admin.query(`create database ${name}`)
  })
  return {
    name,
    url: urlFor(base, name),
    drop: () =>
      withClient(base, async (admin) => {
        await admin.query(`drop database if exists ${name} with (force)`)
      }),
  }
}

/**
 * Creates the throwaway database while holding the server-wide role lock (see ROLE_LOCK_KEY). The lock is released by
 * the returned drop(), which every test file must call (afterAll); a killed process loses it with its connection.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = TEST_DATABASE_URL
  if (base === undefined) {
    throw new Error(SKIP_REASON)
  }
  const lock = await acquireRoleLock(base)
  try {
    const database = await createUnlockedTestDatabase(base)
    let dropped = false
    return {
      ...database,
      drop: async () => {
        if (dropped) {
          return
        }
        dropped = true
        try {
          await database.drop()
        } finally {
          await releaseRoleLock(lock)
        }
      },
    }
  } catch (err) {
    await releaseRoleLock(lock)
    throw err
  }
}

/** Runs one query and returns the rows. */
export function query<R extends pg.QueryResultRow>(
  connectionString: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  return withClient(connectionString, async (client) => (await client.query<R>(text, [...values])).rows)
}

export type LogLine = Record<string, unknown>

/** A pino logger that collects its JSON lines in memory. */
export function memoryLogger() {
  const lines: LogLine[] = []
  const logger = pino(
    { level: 'debug' },
    {
      write(chunk: string) {
        const parsed: unknown = JSON.parse(chunk)
        if (typeof parsed === 'object' && parsed !== null) {
          lines.push(Object.fromEntries(Object.entries(parsed)))
        }
      },
    },
  )
  return { logger, lines }
}

export interface ConnectionProbe {
  /** A postgres:// URL pointing at the probe. It has a password so a leak into output would show. */
  readonly url: string
  /** How many TCP connections have been made to the probe so far. */
  readonly connections: () => number
  readonly close: () => Promise<void>
}

/**
 * A TCP listener that accepts and immediately drops every connection, and counts them. A command that is refused
 * before it connects leaves the count at 0; the control run proves the probe would see a connection.
 */
export async function startConnectionProbe(): Promise<ConnectionProbe> {
  let count = 0
  const server = createServer((socket) => {
    count += 1
    socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the probe has no TCP address')
  }
  const { port } = address
  return {
    url: `postgres://owner:probe-secret-pw@127.0.0.1:${String(port)}/toascribe`,
    connections: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}
