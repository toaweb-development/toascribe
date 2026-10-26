// Entry point: `node dist/index.js` in production, `node --watch src/index.ts` in development
// (typescript §3, §13). Runs pg-boss and shuts down in order on SIGTERM/SIGINT.
import { createDb } from '@toascribe/db'
import { createKeyRing } from '@toascribe/shared'
import { pino } from 'pino'

import { ConfigError, loadConfig } from './config.ts'
import { createLogger } from './lib/logger.ts'
import { startWorker } from './worker.ts'
import type { Worker } from './worker.ts'

/** After this long a shutdown that has not finished is abandoned and the process exits non-zero. */
const SHUTDOWN_TIMEOUT_MS = 40_000

function loadConfigOrExit() {
  try {
    return loadConfig()
  } catch (err) {
    // Logger settings come from the config that just failed, so use a bare one. Names only, no values.
    const bare = pino({ name: 'toascribe-worker' })
    if (err instanceof ConfigError) {
      bare.fatal({ fields: err.fields }, err.message)
    } else {
      bare.fatal('could not read the configuration')
    }
    return process.exit(1)
  }
}

const config = loadConfigOrExit()
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' })

const keyRing = await createKeyRing(
  { version: config.TOASCRIBE_ENCRYPTION_KEY_VERSION, key: config.TOASCRIBE_ENCRYPTION_KEY },
  config.TOASCRIBE_ENCRYPTION_OLD_KEYS,
)

const { db, pool } = createDb({ connectionString: config.DATABASE_URL, applicationName: 'toascribe-worker' })
// An idle client that errors (database restart, network drop) would otherwise crash the process.
pool.on('error', (err) => {
  logger.error({ err }, 'database pool error on an idle client')
})

let worker: Worker | undefined
let shuttingDown = false

/** Stop pg-boss gracefully, end the pool, then exit. */
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) {
    if (exitCode !== 0) {
      process.exit(exitCode) // a fatal error during a clean shutdown must not exit 0
    }
    return
  }
  shuttingDown = true
  logger.info({ reason }, 'shutting down')

  // pg-boss waits up to 30 s for running jobs; leave room for that before giving up.
  const forced = setTimeout(() => {
    logger.error('shutdown timed out, exiting')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forced.unref()

  try {
    if (worker === undefined) {
      await pool.end() // died before the worker came up
    } else {
      await worker.stop()
    }
    logger.info('shutdown complete')
    process.exit(exitCode)
  } catch (err) {
    logger.error({ err }, 'error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
process.on('SIGINT', () => void shutdown('SIGINT', 0))
// Never carry on in an unknown state (typescript §12): log, clean up, exit non-zero.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception')
  void shutdown('uncaughtException', 1)
})
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection')
  void shutdown('unhandledRejection', 1)
})

try {
  worker = await startWorker({
    pool,
    db,
    keyRing,
    publicOrigin: config.PUBLIC_ORIGIN,
    mailDefaults: config,
    databaseUrl: config.DATABASE_URL,
    logger,
    heartbeatFile: config.WORKER_HEARTBEAT_FILE,
    uploadsDir: config.UPLOADS_DIR,
  })
} catch (err) {
  // Typically "pg-boss is not installed": the migration step has not run yet. Exit so the
  // container restarts until it has.
  logger.fatal({ err }, 'worker failed to start')
  await shutdown('startup failure', 1)
}
