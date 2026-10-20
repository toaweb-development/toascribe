import type { ReadyResponse } from '@toascribe/shared'
import type { Logger } from 'pino'

import { pingDatabase } from '../repositories/health.ts'
import type { Pool } from '../repositories/health.ts'

/** How long /api/ready waits for the database before answering 503. */
export const READY_TIMEOUT_MS = 3000

/**
 * Readiness: can this instance serve requests that need the database. A failure is logged with
 * the error and reported to the caller as the bare status, never the error text.
 */
export async function checkReadiness(pool: Pool, logger: Logger): Promise<ReadyResponse> {
  try {
    await pingDatabase(pool, READY_TIMEOUT_MS)
    return { status: 'ok', checks: { database: 'ok' } }
  } catch (err) {
    logger.warn({ err }, 'readiness check failed: database')
    return { status: 'unavailable', checks: { database: 'error' } }
  }
}
