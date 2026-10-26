import { createDb } from '@toascribe/db'
import { createKeyRing, parseKeyMaterial } from '@toascribe/shared'
import type { MediaJob } from '@toascribe/shared'
import { pino } from 'pino'

import { buildApp } from '../src/app.ts'
import type { MailOptions, MailPort, MailRequest } from '../src/ports/mail.ts'
import type { MediaJobPort } from '../src/ports/media-jobs.ts'
import { TEST_DATABASE_URL, SKIP_REASON, noticeIfSkipped } from './db.ts'

export { SKIP_REASON, TEST_DATABASE_URL, noticeIfSkipped }

/** A password-bearing URL on a port nothing listens on: every query fails with ECONNREFUSED. */
export const UNREACHABLE_DATABASE_URL = 'postgres://app:sekret-pw-123@127.0.0.1:1/toascribe'

/** The site's address in tests. https, so the HSTS header is on. */
export const TEST_ORIGIN = 'https://cms.example.test'

/** Fixed test keys. They protect nothing: they only have to be valid and different from each other. */
/** The same key as hex, for a process that reads it from its environment (the worker the mail test starts). */
export const TEST_ENCRYPTION_KEY_HEX = '1f2e3d4c5b6a79881706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0'
export const TEST_ENCRYPTION_KEY = parseKeyMaterial(TEST_ENCRYPTION_KEY_HEX)
export const TEST_SIGNING_KEY = parseKeyMaterial('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f91')

export const testKeyRing = await createKeyRing({ version: 1, key: TEST_ENCRYPTION_KEY })

export type LogLine = Record<string, unknown>

/** A pino logger that collects its JSON lines in memory. */
export function memoryLogger() {
  const lines: LogLine[] = []
  const logger = pino(
    { level: 'debug' },
    {
      write(chunk: string) {
        const parsed: unknown = JSON.parse(chunk)
        if (typeof parsed === 'object' && parsed !== null) {
          lines.push(Object.fromEntries(Object.entries(parsed)))
        }
      },
    },
  )
  return { logger, lines }
}

/**
 * A mail port that keeps what it was asked to send. A throttle key is honoured the simple way: the first mail with a key is
 * queued and later ones with the same key are not (`jobId: null`), whatever the time. The real window is pg-boss's, and the
 * mail integration test exercises that.
 */
export function recordingMail(): MailPort & {
  readonly sent: MailRequest[]
  readonly options: (MailOptions | undefined)[]
} {
  const sent: MailRequest[] = []
  const options: (MailOptions | undefined)[] = []
  const throttled = new Set<string>()
  return {
    sent,
    options,
    sendMail(request, mailOptions) {
      const key = mailOptions?.throttle?.key
      if (key !== undefined) {
        if (throttled.has(key)) {
          return Promise.resolve({ jobId: null })
        }
        throttled.add(key)
      }
      sent.push(request)
      options.push(mailOptions)
      return Promise.resolve({ jobId: `job-${String(sent.length)}` })
    },
  }
}

export interface MakeAppOptions {
  readonly version?: string
  readonly publicOrigin?: string
  readonly clock?: () => Date
  /** TOASCRIBE_TRUSTED_PROXY as set. Default: not given, which is the same as empty. */
  readonly trustedProxy?: string
}

export function makeApp(connectionString: string, versionOrOptions: string | MakeAppOptions = {}) {
  const options = typeof versionOrOptions === 'string' ? { version: versionOrOptions } : versionOrOptions
  const { db, pool } = createDb({ connectionString, connectionTimeoutMillis: 1500 })
  const log = memoryLogger()
  const mail = recordingMail()
  const built = buildApp({
    pool,
    db,
    logger: log.logger,
    version: options.version ?? '9.9.9',
    publicOrigin: options.publicOrigin ?? TEST_ORIGIN,
    signingKey: TEST_SIGNING_KEY,
    keyRing: testKeyRing,
    mail,
    mediaJobs: recordingMediaJobs(),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.trustedProxy === undefined ? {} : { trustedProxy: options.trustedProxy }),
  })
  return { app: built.app, services: built.services, db, pool, mail, ...log }
}

/** A media job port that keeps the jobs it is given, for the tests (the worker's tests run the jobs themselves). */
export function recordingMediaJobs(): MediaJobPort & { readonly jobs: MediaJob[] } {
  const jobs: MediaJob[] = []
  return {
    jobs,
    send(job) {
      jobs.push(job)
      return Promise.resolve()
    },
  }
}
