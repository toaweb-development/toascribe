// `toa dev seed tom`: empties a development database, runs the migrations and the core seed (PLAN «Testdata»).
// "tom" is Norwegian for empty: no content and no accounts, only the five roles and the default settings.
import { createDb, runMigrations, seedCore } from '@toascribe/db'
import { sql } from 'drizzle-orm'
import { pino } from 'pino'
import type { Logger } from 'pino'
import { z } from 'zod'

import { ConfigError, DEV_NODE_ENVS, loadDatabaseConfig, readNodeEnv } from '../config.ts'
import type { EnvSource } from '../config.ts'
import type { CliResult } from '../result.ts'

export interface DevSeedOptions {
  /** Defaults to the process environment (read in config.ts). Tests pass their own. */
  readonly env?: EnvSource
  /** Defaults to a pino logger at LOG_LEVEL on stdout. */
  readonly logger?: Logger
}

/**
 * The guard. It runs before the configuration is read and before any connection is made: the reset is refused unless
 * NODE_ENV is "development" or "test". An unset NODE_ENV refuses too (fail-safe: a container without NODE_ENV must
 * not be wiped). No flag overrides it. Returns the refusal message, or undefined when the command may run.
 */
export function devGuard(nodeEnv: string | undefined): string | undefined {
  if ((DEV_NODE_ENVS as readonly (string | undefined)[]).includes(nodeEnv)) {
    return undefined
  }
  const allowed = DEV_NODE_ENVS.join(' or ')
  const state = nodeEnv === undefined ? 'NODE_ENV is not set' : `NODE_ENV is "${nodeEnv}"`
  return (
    `Refusing to reset the database: ${state}. This command empties every table and runs only when NODE_ENV is ` +
    `${allowed}. It is not available in production, and there is no flag to override that.\n`
  )
}

const TableRows = z.array(z.object({ name: z.string().min(1) }))

/** The database name of a connection URL, for the log. Never the user, password or host. */
function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''))
}

export async function devSeedTom(options: DevSeedOptions = {}): Promise<CliResult> {
  const refusal = devGuard(readNodeEnv(options.env))
  if (refusal !== undefined) {
    // The environment is wrong for this command (exit 2, a bad environment), not a failure underway.
    return { code: 2, stdout: '', stderr: refusal }
  }

  let config
  try {
    config = loadDatabaseConfig(options.env)
  } catch (err) {
    if (err instanceof ConfigError) {
      return { code: 2, stdout: '', stderr: `${err.message}\n` }
    }
    throw err
  }

  const logger = options.logger ?? pino({ name: 'toa', level: config.LOG_LEVEL })
  const connectionString = config.MIGRATION_DATABASE_URL
  const database = databaseName(connectionString)

  try {
    logger.info({ database }, 'resetting the development database: tom')

    // Creates the schema on an empty database and applies what is missing on an older one. It ends with seedCore().
    await runMigrations({ connectionString, logger })

    const { db, pool } = createDb({ connectionString, max: 1, applicationName: 'toascribe-cli' })
    pool.on('error', (err) => {
      logger.error({ err }, 'database connection error')
    })
    try {
      const result = await db.transaction(async (tx) => {
        // Every table in schema public, in one TRUNCATE: no CASCADE is needed and it resets the identity columns
        // (content.short_id). Not drizzle.__drizzle_migrations (emptied, the next run would re-apply 0000_core) and
        // not pgboss.* (pg-boss owns it); both are in other schemas.
        const found = await tx.execute(
          sql`select format('%I.%I', schemaname, tablename) as name from pg_tables
              where schemaname = 'public' order by tablename`,
        )
        const tables = TableRows.parse(found.rows).map((row) => row.name)
        if (tables.length > 0) {
          await tx.execute(sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY`))
        }
        const seeded = await seedCore(tx)
        return { tables: tables.length, ...seeded }
      })
      logger.info(result, 'tables emptied and core roles and settings seeded')
    } finally {
      await pool.end()
    }
    return { code: 0, stdout: '', stderr: '' }
  } catch (err) {
    logger.fatal({ err }, 'dev seed tom failed')
    return { code: 1, stdout: '', stderr: 'dev seed tom failed; see the log above\n' }
  }
}
