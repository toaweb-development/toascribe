import type { ConstructorOptions } from 'pg-boss'

/** The schema pg-boss lives in. init.sql creates it, owned by toascribe_owner. */
export const PGBOSS_SCHEMA = 'pgboss'

/**
 * The PgBoss constructor options for every process that connects as the app role (api, worker).
 * Spread them and add the connection: `new PgBoss({ ...PGBOSS_APP_OPTIONS, connectionString })`.
 *
 * The app role has DML only, so nothing here may make pg-boss run DDL at runtime:
 * - `migrate: false`: start() only checks that the schema is at pg-boss's version (and fails if
 *   the migration step has not run), and the BAM worker that builds indexes is never started.
 *   The migration runner (src/migrate.ts) installs and upgrades the schema as the owner.
 * - `createSchema: false`: never CREATE SCHEMA (only read when migrate is true; set for clarity).
 * - `reindex: false`: REINDEX needs ownership of the job indexes. Bloat is still detected and
 *   reported as a warning; the owner rebuilds with `pg-boss reindex` when needed.
 * - `persistQueueStats: false` (pg-boss's default): when on, the supervisor creates a queue_stats
 *   partition per day, which is DDL.
 *
 * Also do not call createQueue() with `partition: true` (it creates and attaches a table) or
 * deleteAllJobs() without a queue name (TRUNCATE). Both fail with permission denied as the app role.
 */
export const PGBOSS_APP_OPTIONS = {
  schema: PGBOSS_SCHEMA,
  migrate: false,
  createSchema: false,
  reindex: false,
  persistQueueStats: false,
} as const satisfies ConstructorOptions
