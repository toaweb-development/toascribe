import { createDb } from '@toascribe/db'
import { pino } from 'pino'

import { createApp } from '../src/app.ts'

/** Same pattern as packages/db/test/helpers.ts: DB-backed tests skip, with a notice, without this. */
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export const SKIP_REASON = 'skipped: set TEST_DATABASE_URL to a superuser URL on a disposable PostgreSQL 18 server'

export function noticeIfSkipped(suite: string): void {
  if (TEST_DATABASE_URL === undefined) {
    process.stderr.write(`[${suite}] ${SKIP_REASON}\n`)
  }
}

/** A password-bearing URL on a port nothing listens on: every query fails with ECONNREFUSED. */
export const UNREACHABLE_DATABASE_URL = 'postgres://app:sekret-pw-123@127.0.0.1:1/toascribe'

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

export function makeApp(connectionString: string, version = '9.9.9') {
  const { pool } = createDb({ connectionString, connectionTimeoutMillis: 1500 })
  const log = memoryLogger()
  const app = createApp({ pool, logger: log.logger, version })
  return { app, pool, ...log }
}
