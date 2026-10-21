// Test helpers for the database tests of the cli (typescript §6): a throwaway database per test file on a disposable
// server. TEST_DATABASE_URL must be a superuser URL on that server, for example
//   TEST_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/postgres
// The cli tests create no PostgreSQL roles (packages/db's tests do, and run in parallel with these on the same
// server, see createTestDatabase), so the superuser's own URL stands in for the owner role's MIGRATION_DATABASE_URL. The reset and the
// migrations work the same for any role that owns the tables. Without TEST_DATABASE_URL the suites skip and say so.
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

/** Creates an empty database (no tables, no schema objects) with a random name. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = TEST_DATABASE_URL
  if (base === undefined) {
    throw new Error(SKIP_REASON)
  }
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
  await withClient(urlFor(base, name), async (client) => {
    // Migration 0000_core grants audit_log privileges to toascribe_app when that role exists. PostgreSQL roles are
    // cluster-wide, and the db and worker tests create and drop them while this package's tests run in parallel; a
    // grant here would make their `drop role` fail for as long as this database lives. So the database sees no roles:
    // an empty view named pg_roles in front of the catalogue view in search_path (pg_catalog is listed last, not first).
    await client.query('create view public.pg_roles as select null::name as rolname where false')
    await client.query(`alter database ${name} set search_path = public, pg_catalog`)
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
