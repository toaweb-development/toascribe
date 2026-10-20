import { checkConnection, PGBOSS_APP_OPTIONS } from '@toascribe/db'
import type { Db } from '@toascribe/db'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { HEARTBEAT_INTERVAL_MS, removeHeartbeat, writeHeartbeat } from './lib/heartbeat.ts'

export interface WorkerOptions {
  readonly pool: Db['pool']
  /** The app role's URL; pg-boss opens its own connections from it. */
  readonly databaseUrl: string
  readonly logger: Logger
  readonly heartbeatFile: string
  readonly heartbeatIntervalMs?: number
}

export interface Worker {
  /** Graceful stop: lets running jobs finish, then closes pg-boss and ends the pool. */
  readonly stop: () => Promise<void>
}

/**
 * Starts pg-boss as the app role and the heartbeat. No queues or jobs exist in M0.1; later work
 * registers them here (cron schedules are registered in the worker, never in the API, typescript §11).
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
