// Entry point: `node dist/index.js` in production, `node --watch src/index.ts` in development
// (typescript §3, §13). Starts the HTTP server and shuts down in order on SIGTERM/SIGINT.
import { serve } from '@hono/node-server'
import { createDb } from '@toascribe/db'
import { pino } from 'pino'

import { createApp } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { createLogger } from './lib/logger.ts'
import { readPackageVersion } from './lib/version.ts'

/** After this long a shutdown that has not finished is abandoned and the process exits non-zero. */
const SHUTDOWN_TIMEOUT_MS = 10_000

function loadConfigOrExit() {
  try {
    return loadConfig()
  } catch (err) {
    // Logger settings come from the config that just failed, so use a bare one. Names only, no values.
    const bare = pino({ name: 'toascribe-api' })
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

const { pool } = createDb({ connectionString: config.DATABASE_URL, applicationName: 'toascribe-api' })
// An idle client that errors (database restart, network drop) would otherwise crash the process.
pool.on('error', (err) => {
  logger.error({ err }, 'database pool error on an idle client')
})

const app = createApp({ pool, logger, version: readPackageVersion() })
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, 'api listening')
})

let shuttingDown = false

/** Stop accepting connections, finish what is in flight, end the pool, then exit. */
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) {
    if (exitCode !== 0) {
      process.exit(exitCode) // a fatal error during a clean shutdown must not exit 0
    }
    return
  }
  shuttingDown = true
  logger.info({ reason }, 'shutting down')

  const forced = setTimeout(() => {
    logger.error('shutdown timed out, exiting')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forced.unref()

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err === undefined) {
          resolve()
        } else {
          reject(err)
        }
      })
      // close() also closes idle keep-alive connections (Node 19+); active requests finish first.
    })
    await pool.end()
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
