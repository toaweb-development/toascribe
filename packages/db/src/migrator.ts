import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { Logger } from 'pino'

import { PGBOSS_SCHEMA } from './pgboss.ts'

/**
 * Session advisory lock held for the whole run, so two containers never migrate at once
 * (PLAN.md «Installasjon og drift»). A fixed key: 0x746f6173, "toas" in ASCII. The second runner
 * waits for the first and then finds nothing left to do.
 */
export const MIGRATION_LOCK_KEY = 1_953_456_499

/** Where the committed SQL migrations live, next to src/ and dist/. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url))

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

export interface RunMigrationsOptions {
  /** The owner role's URL (MIGRATION_DATABASE_URL). Never the app role. */
  readonly connectionString: string
  readonly logger: Logger
  readonly migrationsFolder?: string
}

/**
 * Applies the Drizzle SQL migrations and installs or upgrades the pg-boss schema, as the owner role,
 * under the migration lock. Safe to run again: both steps skip what is already applied.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const { connectionString, logger } = options
  const client = new pg.Client({ connectionString, application_name: 'toascribe-migrate' })
  await client.connect()
  try {
    await acquireLock(client, logger)
    try {
      const db = drizzle({ client })
      await migrate(db, {
        migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
        migrationsSchema: 'drizzle',
        migrationsTable: '__drizzle_migrations',
      })
      logger.info('drizzle migrations applied')

      await migratePgBoss(connectionString, logger)
      logger.info({ schema: PGBOSS_SCHEMA }, 'pg-boss schema up to date')
    } finally {
      await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    await client.end()
  }
}

async function acquireLock(client: pg.Client, logger: Logger): Promise<void> {
  const tried = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1::bigint) as locked', [
    MIGRATION_LOCK_KEY,
  ])
  if (tried.rows[0]?.locked === true) {
    return
  }
  logger.info('another migration is running; waiting for the migration lock')
  await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY])
}

/**
 * Runs `pg-boss migrate` from the pg-boss package (a production dependency, so it is in the image).
 * It creates the schema objects on a fresh database and upgrades an older one. It is the path
 * pg-boss itself provides for installations that start with `migrate: false`: it runs the index
 * builds a migration needs directly, where a library start() would queue them for the BAM worker,
 * which the app role never runs.
 *
 * The connection goes through the child's environment (PGBOSS_DATABASE_URL), never its argv,
 * which other processes can read. cwd is this package, so no stray pgboss.json is picked up.
 */
async function migratePgBoss(connectionString: string, logger: Logger): Promise<void> {
  const cli = await resolvePgBossCli()
  const child = spawn(process.execPath, [cli, 'migrate'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, PGBOSS_DATABASE_URL: connectionString, PGBOSS_SCHEMA: PGBOSS_SCHEMA },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = logger.child({ component: 'pg-boss' })
  createInterface({ input: child.stdout }).on('line', (line) => {
    log.info(line)
  })
  createInterface({ input: child.stderr }).on('line', (line) => {
    log.error(line)
  })

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) {
    throw new Error(`pg-boss migrate failed (exit code ${String(code)})`)
  }
}

async function resolvePgBossCli(): Promise<string> {
  const manifestUrl = import.meta.resolve('pg-boss/package.json')
  const manifest: unknown = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'))
  const bin = typeof manifest === 'object' && manifest !== null && 'bin' in manifest ? manifest.bin : undefined
  const path = typeof bin === 'object' && bin !== null && 'pg-boss' in bin ? bin['pg-boss'] : undefined
  if (typeof path !== 'string') {
    throw new Error('pg-boss/package.json has no "pg-boss" bin')
  }
  return fileURLToPath(new URL(path, manifestUrl))
}
