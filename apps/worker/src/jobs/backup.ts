// The daily backup (M1.7, K-292): with `[backup] schedule = true` in toascribe.toml, one backup a night as the app role, then the
// oldest pruned so the newest `keep` (7) remain; off by default. The status of each run is in `backup_status` (Nettstedshelse).
// Never with the keys: a backup with secrets is made by hand (`toa backup create --include-secrets`).
import { pruneBackups, readBackupConfig, takeBackup } from '@toascribe/backup'
import type { Logger } from 'pino'

export const BACKUP_DAILY = 'backup.daily'
/**
 * One try, and hours to finish: a retry of a failed backup would fail the same way, and a backup that outlives its expiry would be
 * started again while the first pg_dump still runs.
 */
export const BACKUP_QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 6 * 60 * 60 } as const
/** 03:30 UTC, after the night's clean-up and trash purge. */
export const BACKUP_CRON = '30 3 * * *'

export interface BackupJobDeps {
  readonly databaseUrl: string
  readonly uploadsDir: string
  readonly backupsDir: string
  readonly configFile: string
  readonly version: string
  readonly logger: Logger
  readonly now?: () => Date
}

/** Whether the daily backup is on (toascribe.toml); a broken file is logged and counts as off. */
export function dailyBackupOn(deps: Pick<BackupJobDeps, 'configFile' | 'logger'>): boolean {
  try {
    return readBackupConfig(deps.configFile).schedule
  } catch (err) {
    deps.logger.error({ err }, 'toascribe.toml [backup] cannot be read: no daily backup')
    return false
  }
}

export async function runDailyBackup(deps: BackupJobDeps): Promise<void> {
  const settings = readBackupConfig(deps.configFile)
  const made = await takeBackup({
    databaseUrl: deps.databaseUrl,
    uploadsDir: deps.uploadsDir,
    backupsDir: deps.backupsDir,
    configFile: deps.configFile,
    version: deps.version,
    now: deps.now?.() ?? new Date(),
    logger: deps.logger,
  })
  const removed = await pruneBackups(deps.backupsDir, settings.keep)
  deps.logger.info({ file: made.file.split('/').pop(), size: made.size, pruned: removed.length }, 'daily backup made')
}
