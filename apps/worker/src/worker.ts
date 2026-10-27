import { checkConnection, PGBOSS_APP_OPTIONS } from '@toascribe/db'
import type { Database, Db } from '@toascribe/db'
import type { KeyRing } from '@toascribe/shared'
import type { UpdateSource } from '@toascribe/updates'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { registerJobs } from './jobs/index.ts'
import { HEARTBEAT_INTERVAL_MS, removeHeartbeat, writeHeartbeat } from './lib/heartbeat.ts'
import type { MailEnvDefaults, TransportFactory } from './mail/smtp.ts'

export interface WorkerOptions {
  readonly pool: Db['pool']
  readonly db: Database
  /** The app role's URL; pg-boss opens its own connections from it. */
  readonly databaseUrl: string
  readonly logger: Logger
  readonly heartbeatFile: string
  readonly heartbeatIntervalMs?: number
  /** TOASCRIBE_ENCRYPTION_KEY and the older keys: the SMTP password and the one-time tokens in the mail jobs are decrypted with them. */
  readonly keyRing: KeyRing
  /** PUBLIC_ORIGIN: the links in the mails are built on it. */
  readonly publicOrigin: string
  /** The SMTP and sender defaults from the environment, behind the `smtp_*` and `mail_from_*` settings. */
  readonly mailDefaults: MailEnvDefaults
  /** Tests only: where the mail goes instead of SMTP. */
  readonly transport?: TransportFactory
  /** Tests only: how often the queues are polled, in seconds (default 2 for mail and 30 for the clean-up). */
  readonly pollingSeconds?: number
  /** UPLOADS_DIR: the media library's volume. */
  readonly uploadsDir: string
  /** The backups volume and toascribe.toml (M1.7), and the version a backup is stamped with. */
  readonly backupsDir: string
  readonly configFile: string
  readonly version: string
  /** The update check (M1.7): off when TOASCRIBE_UPDATE_CHECK=off; the source is ghcr.io unless a test gives its own. */
  readonly updateCheck: { readonly serverAllows: boolean; readonly source?: UpdateSource }
  /** Tests only: the clock of the clean-up jobs. */
  readonly now?: () => Date
}

export interface Worker {
  /** Graceful stop: lets running jobs finish, then closes pg-boss and ends the pool. */
  readonly stop: () => Promise<void>
}

/**
 * Starts pg-boss as the app role, registers the queues, the handlers and the cron schedules (jobs/index.ts: the e-mail job and
 * the daily clean-up; schedules are registered in the worker, never in the API, typescript §11), and starts the heartbeat.
 * Fails if the migration step has not run: PGBOSS_APP_OPTIONS has migrate:false, so start() only
 * checks the schema version (packages/db, src/pgboss.ts).
 */
export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const { pool, logger, heartbeatFile } = options

  const boss = new PgBoss({ ...PGBOSS_APP_OPTIONS, connectionString: options.databaseUrl })
  // Without a listener an 'error' event would throw and crash the process.
  boss.on('error', (err) => {
    logger.error({ err }, 'pg-boss error')
  })
  try {
    await boss.start()
  } catch (err) {
    // Release whatever start() opened before the failure; the original error is the one to report.
    await boss.stop({ graceful: false }).catch(() => undefined)
    throw err
  }

  try {
    await registerJobs(
      boss,
      {
        email: {
          db: options.db,
          keyRing: options.keyRing,
          logger,
          publicOrigin: options.publicOrigin,
          mailDefaults: options.mailDefaults,
          ...(options.transport === undefined ? {} : { transport: options.transport }),
        },
        cleanup: { db: options.db, logger, ...(options.now === undefined ? {} : { now: options.now }) },
        content: { db: options.db, logger, ...(options.now === undefined ? {} : { now: options.now }) },
        backup: {
          databaseUrl: options.databaseUrl,
          uploadsDir: options.uploadsDir,
          backupsDir: options.backupsDir,
          configFile: options.configFile,
          version: options.version,
          logger,
          ...(options.now === undefined ? {} : { now: options.now }),
        },
        updates: {
          db: options.db,
          logger,
          version: options.version,
          serverAllows: options.updateCheck.serverAllows,
          ...(options.updateCheck.source === undefined ? {} : { source: options.updateCheck.source }),
          ...(options.now === undefined ? {} : { now: options.now }),
        },
        media: {
          db: options.db,
          logger,
          uploadsDir: options.uploadsDir,
          ...(options.now === undefined ? {} : { now: options.now }),
        },
        ...(options.pollingSeconds === undefined ? {} : { pollingSeconds: options.pollingSeconds }),
      },
      logger,
    )
  } catch (err) {
    await boss.stop({ graceful: false }).catch(() => undefined)
    throw err
  }

  // The beat is written only after a successful `select 1`, so a worker that has lost its database
  // goes stale and is reported unhealthy. A beat still in flight is never overlapped.
  let beating = false
  async function beat(): Promise<void> {
    if (beating) {
      return
    }
    beating = true
    try {
      await checkConnection(pool)
      await writeHeartbeat(heartbeatFile)
    } catch (err) {
      logger.warn({ err }, 'heartbeat skipped')
    } finally {
      beating = false
    }
  }
  await beat()
  const timer = setInterval(() => void beat(), options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS)

  logger.info('worker ready')

  let stopping: Promise<void> | undefined
  return {
    stop: () => {
      stopping ??= (async () => {
        clearInterval(timer)
        await boss.stop({ graceful: true })
        await pool.end()
        await removeHeartbeat(heartbeatFile)
      })()
      return stopping
    },
  }
}
