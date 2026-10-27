// Restoring a backup (M1.7, Tor's decisions), from the CLI only and as the owner role (MIGRATION_DATABASE_URL: the migrate service,
// `docker compose run --rm migrate toa backup restore <file>`):
//   1. The archive is read and checked whole (manifest, every sha256) into a fresh folder in the backups volume; nothing else is
//      touched yet. A backup from a newer toascribe, or with a migration this build does not have, is refused.
//   2. Maintenance mode on. The database is replaced in one transaction (psql --single-transaction: the old objects dropped, the
//      dump's SQL, the app role's grants), so a failure leaves the database as it was.
//   3. The uploads are replaced by the archive's, the migrations run (an older backup is brought up to this build), the site's
//      cache is emptied (`*`), and maintenance mode is off again, also when something failed.
import { randomBytes } from 'node:crypto'
import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createDb, readMaintenanceMode, readMigrationJournal, runMigrations, setMaintenanceMode } from '@toascribe/db'
import type { Logger } from 'pino'

import { BackupError, readBackup } from './archive.ts'
import type { ReadOptions } from './archive.ts'
import { DATABASE_PATH, SECRETS_PATH, UPLOADS_PREFIX, compareVersions } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { capture, pgEnvironment, run } from './tools.ts'

/** The role the app connects as (docker/postgres/init.sql): it gets its rights back after a restore. */
export const APP_ROLE = 'toascribe_app'

/** Drops what a dump brings back, in the three schemas a backup holds, but never `public` itself (its default privileges stay). */
const DROP_SQL = `
DO $drop$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT format('DROP %s IF EXISTS %I.%I CASCADE',
             CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
             n.nspname, c.relname) AS statement
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i'))
  LOOP
    EXECUTE item.statement;
  END LOOP;
  FOR item IN
    SELECT format('DROP TYPE IF EXISTS %I.%I CASCADE', n.nspname, t.typname) AS statement
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE item.statement;
  END LOOP;
  FOR item IN
    SELECT format('DROP FUNCTION IF EXISTS %s CASCADE', p.oid::regprocedure) AS statement
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE item.statement;
  END LOOP;
END
$drop$;
DROP SCHEMA IF EXISTS pgboss CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
`

/** The app role's rights on what the dump made (pg_restore --no-privileges leaves them out), as docker/postgres/init.sql gives them. */
const GRANT_SQL = `
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE ON SCHEMA pgboss TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
    GRANT USAGE ON SCHEMA drizzle TO ${APP_ROLE};
    GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${APP_ROLE};
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO ${APP_ROLE};
  END IF;
END
$grant$;
`

export interface RestoreOptions extends ReadOptions {
  /** The owner role's URL (MIGRATION_DATABASE_URL). */
  readonly ownerUrl: string
  readonly uploadsDir: string
  readonly backupsDir: string
  /** This build's version (root package.json). */
  readonly version: string
  readonly logger: Logger
  readonly now: () => Date
}

export interface CheckedBackup {
  readonly manifest: Manifest
  /** The folder the archive was unpacked into (in the backups volume); removed by restoreBackup or discardChecked. */
  readonly folder: string
}

/** Step 1: reads and checks the archive into a fresh folder, and refuses one this build cannot take. Changes nothing. */
export async function checkBackup(file: string, options: RestoreOptions): Promise<CheckedBackup> {
  const folder = join(options.backupsDir, `.restore-${randomBytes(6).toString('hex')}`)
  await mkdir(folder, { recursive: false, mode: 0o700 })
  try {
    const manifest = await readBackup(file, { ...options, write: folder })
    if (compareVersions(manifest.toascribe, options.version) > 0) {
      throw new BackupError(
        `The backup is from toascribe ${manifest.toascribe}, newer than this one (${options.version}). Update toascribe first.`,
      )
    }
    const journal = readMigrationJournal()
    if (!journal.some((entry) => entry.when === manifest.migration.when) && manifest.migration.when !== 0) {
      throw new BackupError(
        `The backup's database has a migration this build does not know (${manifest.migration.tag}).`,
      )
    }
    return { manifest, folder }
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
}

export async function discardChecked(checked: CheckedBackup): Promise<void> {
  await rm(checked.folder, { recursive: true, force: true })
}

/** Turns maintenance mode on or off in the database, when it has the setting table yet (an empty database has not). */
async function maintenance(ownerUrl: string, enabled: boolean, now: Date, logger: Logger): Promise<void> {
  const { db, pool } = createDb({ connectionString: ownerUrl, max: 1, applicationName: 'toascribe-restore' })
  try {
    await db.transaction(async (tx) => {
      await setMaintenanceMode(tx, { enabled, message: '', retryAfter: 600 }, now)
    })
  } catch (error) {
    logger.warn({ err: error, enabled }, 'maintenance mode could not be set (no settings table yet)')
  } finally {
    await pool.end()
  }
}

export interface RestoredBackup {
  readonly manifest: Manifest
  /** Where the keys from the backup were written (only when it held them): move them into .env and delete the file. */
  readonly secretsFile: string | undefined
}

/** Steps 2 and 3 for a checked backup. Maintenance mode is off at the end, also after a failure. */
export async function restoreBackup(checked: CheckedBackup, options: RestoreOptions): Promise<RestoredBackup> {
  const { folder, manifest } = checked
  const env = pgEnvironment(options.ownerUrl)
  let wasOn = false
  try {
    const { db, pool } = createDb({ connectionString: options.ownerUrl, max: 1, applicationName: 'toascribe-restore' })
    try {
      wasOn = (await readMaintenanceMode(db)).enabled
    } catch {
      wasOn = false
    } finally {
      await pool.end()
    }
    await maintenance(options.ownerUrl, true, options.now(), options.logger)

    // The dump as SQL, and the whole replacement in one transaction.
    const drop = join(folder, 'drop.sql')
    const restore = join(folder, 'restore.sql')
    const grant = join(folder, 'grant.sql')
    await writeFile(drop, DROP_SQL, { mode: 0o600 })
    await writeFile(grant, GRANT_SQL, { mode: 0o600 })
    // The dump's table of contents without the schema `public` itself (it stays, with its default privileges).
    const list = join(folder, 'restore.list')
    const contents = await capture('pg_restore', ['--list', join(folder, DATABASE_PATH)], env)
    await writeFile(
      list,
      contents
        .split('\n')
        .filter((line) => !/ (SCHEMA|COMMENT) - (SCHEMA )?public /.test(line))
        .join('\n'),
      { mode: 0o600 },
    )
    await run(
      'pg_restore',
      ['--no-owner', '--no-privileges', `--use-list=${list}`, `--file=${restore}`, join(folder, DATABASE_PATH)],
      env,
    )
    await run(
      'psql',
      ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', drop, '-f', restore, '-f', grant],
      env,
    )
    options.logger.info({ toascribe: manifest.toascribe, migration: manifest.migration.tag }, 'database restored')
    // The restored database has its own setting: the site stays in maintenance until the end.
    await maintenance(options.ownerUrl, true, options.now(), options.logger)

    // The uploads: the archive's in place of what is there.
    const staged = join(folder, UPLOADS_PREFIX.replace(/\/$/, ''))
    await mkdir(options.uploadsDir, { recursive: true })
    for (const name of await readdir(options.uploadsDir)) {
      await rm(join(options.uploadsDir, name), { recursive: true, force: true })
    }
    try {
      for (const name of await readdir(staged)) {
        await cp(join(staged, name), join(options.uploadsDir, name), { recursive: true, errorOnExist: true })
      }
    } catch (error) {
      if (typeof error !== 'object' || error === null || Reflect.get(error, 'code') !== 'ENOENT') throw error
    }

    // An older backup is brought up to this build.
    await runMigrations({ connectionString: options.ownerUrl, logger: options.logger })

    let secretsFile: string | undefined
    if (manifest.secrets) {
      const stamp = options.now().toISOString().replace(/[-:.]/g, '')
      secretsFile = join(options.backupsDir, `restored-secrets-${stamp}.json`)
      await rename(join(folder, SECRETS_PATH), secretsFile)
    }
    return { manifest, secretsFile }
  } finally {
    // Off again (and the site's cache emptied by it), also after a failure; on only when it was on before the restore.
    await maintenance(options.ownerUrl, wasOn, options.now(), options.logger)
    await rm(folder, { recursive: true, force: true })
  }
}
