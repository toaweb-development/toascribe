// The last backup's status (M1.7), in the `backup_status` setting: written after every backup the CLI or the worker makes, shown in
// Nettstedshelse. It names the file (not its path) and, on a failure, a reason without paths or values.
import { createDb, schema, writeSetting } from '@toascribe/db'
import type { DbExecutor } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import { eq } from 'drizzle-orm'
import type { LastBackupStatus } from '@toascribe/shared'

/** A failure as a reason for the status: the first line, paths replaced, at most 300 characters. */
export function statusReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return (text.split('\n')[0] ?? '').replace(/\/[^\s'"]+/g, '[sti]').slice(0, 300)
}

export async function recordBackupStatus(databaseUrl: string, status: LastBackupStatus): Promise<void> {
  const { db, pool } = createDb({ connectionString: databaseUrl, max: 1, applicationName: 'toascribe-backup' })
  try {
    await writeSetting(db, 'backup_status', status)
  } finally {
    await pool.end()
  }
}

/** Adds a backup to `backup_log` (the newest 200 this install made), so a restore can tell one made here from one made elsewhere. */
export async function recordBackupMade(
  databaseUrl: string,
  entry: { file: string; createdAt: string; manifest: string },
): Promise<void> {
  const { db, pool } = createDb({ connectionString: databaseUrl, max: 1, applicationName: 'toascribe-backup' })
  try {
    await db.transaction(async (tx) => {
      const log = await readBackupLog(tx)
      // Entries from before the fingerprint have none: written without the key, never as `undefined` (not JSON).
      const kept = log
        .filter((made) => made.file !== entry.file)
        .map((made) => ({
          file: made.file,
          createdAt: made.createdAt,
          ...(made.manifest === undefined ? {} : { manifest: made.manifest }),
        }))
      await writeSetting(tx, 'backup_log', [entry, ...kept].slice(0, 200))
    })
  } finally {
    await pool.end()
  }
}

/** The backups this install made, newest first (empty when the setting is missing or broken). */
export async function readBackupLog<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<{ file: string; createdAt: string; manifest?: string | undefined }[]> {
  const [row] = await db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'backup_log'))
  const parsed = CoreSettings.shape.backup_log.safeParse(row?.value)
  return parsed.success ? parsed.data : []
}
