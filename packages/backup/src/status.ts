// The last backup's status (M1.7), in the `backup_status` setting: written after every backup the CLI or the worker makes, shown in
// Nettstedshelse. It names the file (not its path) and, on a failure, a reason without paths or values.
import { createDb, writeSetting } from '@toascribe/db'
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
