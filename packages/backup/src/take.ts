// One backup as the CLI and the worker take it (M1.7): the database's newest migration read, the backup made by the [backup]
// section of toascribe.toml, and its status recorded (also when it failed, with a reason and no path).
import { createDb } from '@toascribe/db'

import { createBackup } from './archive.ts'
import type { CreatedBackup } from './archive.ts'
import { readBackupConfig } from './config.ts'
import { readDatabaseMigration } from './files.ts'
import { manifestDigest } from './manifest.ts'
import { recordBackupMade, recordBackupStatus, statusReason } from './status.ts'

export interface TakeOptions {
  readonly databaseUrl: string
  readonly uploadsDir: string
  readonly backupsDir: string
  /** toascribe.toml (TOASCRIBE_CONFIG_FILE). */
  readonly configFile: string
  readonly version: string
  /** The keys to keep (--include-secrets); never from the worker. */
  readonly secrets?: Readonly<Record<string, string>>
  readonly now: Date
  /** Told when the backup could not be added to `backup_log`. */
  readonly logger?: { warn(object: object, message: string): void }
}

export async function takeBackup(options: TakeOptions): Promise<CreatedBackup> {
  const settings = readBackupConfig(options.configFile)
  const record = (status: Parameters<typeof recordBackupStatus>[1]) =>
    recordBackupStatus(options.databaseUrl, status).catch(() => undefined)
  try {
    const { db, pool } = createDb({
      connectionString: options.databaseUrl,
      max: 1,
      applicationName: 'toascribe-backup',
    })
    let migration: { tag: string; when: number }
    try {
      migration = await readDatabaseMigration(db)
    } finally {
      await pool.end()
    }
    const made = await createBackup({
      databaseUrl: options.databaseUrl,
      uploadsDir: options.uploadsDir,
      backupsDir: options.backupsDir,
      version: options.version,
      migration,
      now: options.now,
      encrypt: settings.encrypt,
      ...(settings.recipient === undefined ? {} : { recipient: settings.recipient }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    })
    await record({
      at: options.now.toISOString(),
      ok: true,
      file: made.file.split('/').pop() ?? null,
      size: made.size,
      error: null,
      scheduled: settings.schedule,
    })
    await recordBackupMade(options.databaseUrl, {
      file: made.file.split('/').pop() ?? made.file,
      createdAt: made.manifest.createdAt,
      manifest: manifestDigest(made.manifest),
    }).catch((error: unknown) => {
      // A restore of this backup would then warn that it was not made here: say why now.
      options.logger?.warn(
        { err: error },
        'the backup is made, but it could not be added to the list of backups made here',
      )
    })
    return made
  } catch (error) {
    await record({
      at: options.now.toISOString(),
      ok: false,
      file: null,
      size: null,
      error: statusReason(error),
      scheduled: settings.schedule,
    })
    throw error
  }
}
