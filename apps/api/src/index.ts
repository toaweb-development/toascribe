// Entry point: `node dist/index.js` in production, `node --watch src/index.ts` in development
// (typescript §3, §13). Starts the HTTP server and shuts down in order on SIGTERM/SIGINT.
import { serve } from '@hono/node-server'
import { createDb } from '@toascribe/db'
import { createKeyRing } from '@toascribe/shared'
import { pino } from 'pino'

import { createMailQueue } from './adapters/mail-queue.ts'
import { createMediaQueue } from './adapters/media-queue.ts'
import { buildApp } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { createLogger } from './lib/logger.ts'
import { readPackageVersion } from './lib/version.ts'
import { announceSetupToken } from './services/setup.ts'

/** After this long a shutdown that has not finished is abandoned and the process exits non-zero. */
const SHUTDOWN_TIMEOUT_MS = 10_000

/** How many times, and how far apart, the start-up tries to make the setup token if the database does not answer. */
const SETUP_TOKEN_ATTEMPTS = 10
const SETUP_TOKEN_RETRY_MS = 3000

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

const keyRing = await createKeyRing(
  { version: config.TOASCRIBE_ENCRYPTION_KEY_VERSION, key: config.TOASCRIBE_ENCRYPTION_KEY },
  config.TOASCRIBE_ENCRYPTION_OLD_KEYS,
)

const { db, pool } = createDb({ connectionString: config.DATABASE_URL, applicationName: 'toascribe-api' })
// An idle client that errors (database restart, network drop) would otherwise crash the process.
pool.on('error', (err) => {
  logger.error({ err }, 'database pool error on an idle client')
})

const mailQueue = createMailQueue({ connectionString: config.DATABASE_URL, keyRing, logger })
const mediaQueue = createMediaQueue({ connectionString: config.DATABASE_URL, logger })

const { app, services } = buildApp({
  pool,
  db,
  logger,
  version: readPackageVersion(),
  publicOrigin: config.PUBLIC_ORIGIN,
  signingKey: config.TOASCRIBE_SIGNING_KEY,
  trustedProxy: config.TOASCRIBE_TRUSTED_PROXY,
  keyRing,
  mail: mailQueue,
  mediaJobs: mediaQueue,
  uploadsDir: config.UPLOADS_DIR,
  uploadCapMb: config.UPLOAD_MAX_SIZE_MB,
  siteUrlInternal: config.SITE_URL_INTERNAL,
  valkeyUrl: config.CACHE_VALKEY_URL,
  environment: config.NODE_ENV,
  serverAllowsUpdateCheck: config.TOASCRIBE_UPDATE_CHECK !== 'off',
  configFile: config.TOASCRIBE_CONFIG_FILE,
})
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV }, 'api listening')
})

/**
 * A site that is not installed gets a new setup token, written to the log (services/setup.ts). It is made after the server
 * is listening and tried again a few times: the api serves /api/health with the database down, and a database that is a
 * moment late (a restart, the migrate step finishing) should not leave the wizard without a token until the next start.
 */
async function prepareSetup(): Promise<void> {
  for (let attempt = 1; attempt <= SETUP_TOKEN_ATTEMPTS; attempt += 1) {
    try {
      await announceSetupToken({ install: services.install, logger, publicOrigin: config.PUBLIC_ORIGIN })
      return
    } catch (err) {
      logger.error({ err, attempt }, 'could not make the setup token')
      await new Promise<void>((resolve) => setTimeout(resolve, SETUP_TOKEN_RETRY_MS))
    }
  }
  logger.error('the setup token could not be made; restart the api, or run `toa core setup-token`')
}
void prepareSetup()

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
    await mailQueue.stop()
    await mediaQueue.stop()
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
