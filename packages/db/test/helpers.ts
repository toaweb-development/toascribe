// Test helpers for the integration tests against a real PostgreSQL (typescript §6).
//
// TEST_DATABASE_URL must be a superuser URL on a DISPOSABLE server (a throwaway postgres:18-alpine
// container locally, the PostgreSQL service in CI), for example
//   TEST_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/postgres
// Each test file creates its own database, runs docker/postgres/init.sql in it (which creates the
// cluster-wide roles toascribe_owner and toascribe_app), and drops all of it again afterwards.
// Without TEST_DATABASE_URL the suites skip and say so.
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export const SKIP_REASON = 'skipped: set TEST_DATABASE_URL to a superuser URL on a disposable PostgreSQL 18 server'

/** Writes a visible notice when the database tests cannot run. */
export function noticeIfSkipped(suite: string): void {
  if (TEST_DATABASE_URL === undefined) {
    process.stderr.write(`[${suite}] ${SKIP_REASON}\n`)
  }
}

export const OWNER_ROLE = 'toascribe_owner'
export const APP_ROLE = 'toascribe_app'

const INIT_SQL = fileURLToPath(new URL('../../../docker/postgres/init.sql', import.meta.url))

/**
 * psql's variable interpolation for the two forms init.sql uses: :'name' becomes a quoted literal
 * and :"name" a quoted identifier (as psql does with standard_conforming_strings on). Any other
 * :name left in the file, or a variable not given, fails the test instead of passing silently.
 */
export function interpolatePsqlVariables(sql: string, variables: Readonly<Record<string, string>>): string {
  const rendered = sql.replace(/:'([a-z_]+)'|:"([a-z_]+)"/g, (_match, literal?: string, identifier?: string) => {
    const name = literal ?? identifier ?? ''
    const value = variables[name]
    if (value === undefined) {
      throw new Error(`init.sql uses psql variable ${name}, which the test did not set`)
    }
    return literal === undefined ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "''")}'`
  })
  const leftover = /(?<!:):[a-z_]/.exec(rendered.replace(/--.*$/gm, ''))
  if (leftover !== null) {
    throw new Error(`init.sql has a psql variable form the test does not handle near "${leftover[0]}"`)
  }
  return rendered
}

export interface TestDatabase {
  readonly name: string
  /** Superuser connection to the test database. */
  readonly adminUrl: string
  /** toascribe_owner: what MIGRATION_DATABASE_URL holds. */
  readonly ownerUrl: string
  /** toascribe_app: what DATABASE_URL holds. */
  readonly appUrl: string
  readonly drop: () => Promise<void>
}

function urlFor(base: string, database: string, user?: string, password?: string): string {
  const url = new URL(base)
  url.pathname = `/${database}`
  if (user !== undefined && password !== undefined) {
    url.username = user
    url.password = password
  }
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
 * Creates a fresh database the way the postgres image does (owned by the superuser), then runs
 * init.sql in it with generated passwords. The passwords contain a quote, so the test also proves
 * that init.sql quotes its variables.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const base = TEST_DATABASE_URL
  if (base === undefined) {
    throw new Error(SKIP_REASON)
  }
  const name = `toascribe_test_${randomBytes(4).toString('hex')}`
  const ownerPassword = `${randomBytes(18).toString('base64url')}'o`
  const appPassword = `${randomBytes(18).toString('base64url')}'a`

  await withClient(base, async (admin) => {
    const { rows } = await admin.query<{ super: boolean; version: number }>(
      `select rolsuper as super, current_setting('server_version_num')::int as version
         from pg_roles where rolname = current_user`,
    )
    const me = rows[0]
    if (me?.super !== true) {
      throw new Error('TEST_DATABASE_URL must connect as a superuser (it runs init.sql, as the postgres image does)')
    }
    if (me.version < 170000) {
      throw new Error(`PostgreSQL ${String(me.version)} is below the floor (17; 18 preferred)`)
    }
    const existing = await admin.query<{ rolname: string }>('select rolname from pg_roles where rolname = any($1)', [
      [OWNER_ROLE, APP_ROLE],
    ])
    if (existing.rows.length > 0) {
      throw new Error(
        `roles ${existing.rows.map((r) => r.rolname).join(', ')} already exist on the TEST_DATABASE_URL server. ` +
          'Point it at a disposable server, or drop them there if a previous run was killed.',
      )
    }
    await admin.query(`create database ${name}`)
  })

  const adminUrl = urlFor(base, name)
  const sql = interpolatePsqlVariables(await readFile(INIT_SQL, 'utf8'), {
    db_name: name,
    owner_password: ownerPassword,
    app_password: appPassword,
  })
  await withClient(adminUrl, (client) => client.query(sql))

  return {
    name,
    adminUrl,
    ownerUrl: urlFor(base, name, OWNER_ROLE, ownerPassword),
    appUrl: urlFor(base, name, APP_ROLE, appPassword),
    drop: () =>
      withClient(base, async (admin) => {
        await admin.query(`drop database if exists ${name} with (force)`)
        await admin.query(`drop role if exists ${APP_ROLE}`)
        await admin.query(`drop role if exists ${OWNER_ROLE}`)
      }),
  }
}

/** Runs one query as the given URL's role and returns the rows. */
export function queryAs<R extends pg.QueryResultRow>(
  connectionString: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  return withClient(connectionString, async (client) => (await client.query<R>(text, [...values])).rows)
}

/** The SQLSTATE of a rejected promise, or undefined when it resolved. */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (err) {
    if (err instanceof pg.DatabaseError) {
      return err.code
    }
    throw err
  }
}
