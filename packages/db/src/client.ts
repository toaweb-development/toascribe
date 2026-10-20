import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './schema/index.ts'

export type Schema = typeof schema
export type Database = NodePgDatabase<Schema>

export interface CreateDbOptions {
  /** The app role's URL (DATABASE_URL). Read by the caller's config.ts, never here (typescript §9). */
  readonly connectionString: string
  /** Pool size. pg's default is 10. */
  readonly max?: number
  /** Shown in pg_stat_activity, e.g. 'toascribe-api'. */
  readonly applicationName?: string
  /** How long to wait for a free or new connection before failing. Default 5000 ms. */
  readonly connectionTimeoutMillis?: number
}

export interface Db {
  readonly db: Database
  /** Close it on shutdown with `await pool.end()` (typescript §13). */
  readonly pool: pg.Pool
}

/**
 * A Drizzle client over a pg.Pool. The caller owns the pool: attach `pool.on('error', …)` to log
 * errors from idle connections (unhandled, they crash the process) and end it on SIGTERM.
 */
export function createDb(options: CreateDbOptions): Db {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
  })
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  return { db, pool }
}

/**
 * Readiness probe for GET /api/ready: resolves when the database answers `select 1`, rejects
 * otherwise (no connection within connectionTimeoutMillis, auth failure, server down).
 */
export async function checkConnection(pool: pg.Pool): Promise<void> {
  await pool.query('select 1')
}
