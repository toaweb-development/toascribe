// The daily clean-up (M0.3, PLAN «Personvern»): what must not be kept for ever is removed, and each run says how much. Three
// jobs, each on its own schedule, so one that fails does not hold the others back:
// - `cleanup.credentials`: sessions that have ended, one-time links that are used up or expired, and the site's cache change log of more than a day;
// - `cleanup.ip-retention`: IP addresses older than `ip_retention_days` on sessions, comments, application passwords and the
//   audit log, and the login attempts of that age;
// - `cleanup.spam-comments`: comments marked as spam for longer than `spam_comment_retention_days`.
// Each step is idempotent: a second run finds nothing left. A step that fails does not stop the next one; the job fails after
// the last, so pg-boss tries it again, and the log says which step it was.
import type { Database } from '@toascribe/db'
import type { Logger } from 'pino'

import { summarizeError } from '../lib/redact.ts'
import {
  clearAppPasswordIps,
  clearCommentIps,
  clearOldAuditIps,
  clearSessionIps,
  deleteExpiredSessions,
  deleteOldCacheInvalidations,
  deleteOldLoginAttempts,
  deleteOldSpamComments,
  deleteSpentAccountTokens,
} from '../repositories/cleanup.ts'
import { IP_RETENTION, SPAM_RETENTION, readRetentionDays } from '../repositories/settings.ts'

export const CLEANUP_CREDENTIALS = 'cleanup.credentials'
export const CLEANUP_IP_RETENTION = 'cleanup.ip-retention'
export const CLEANUP_SPAM_COMMENTS = 'cleanup.spam-comments'

export interface CleanupDeps {
  readonly db: Database
  readonly logger: Logger
  /** The clock. Tests set it. */
  readonly now?: () => Date
}

/** How many rows each step changed. */
export type CleanupCounts = Readonly<Record<string, number>>

type Step = readonly [name: string, run: () => Promise<number>]

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/** Runs the steps in order and logs the counts. Throws after the last step if any failed. */
async function runSteps(job: string, steps: readonly Step[], logger: Logger): Promise<CleanupCounts> {
  const counts: Record<string, number> = {}
  const failed: string[] = []
  for (const [name, run] of steps) {
    try {
      counts[name] = await run()
    } catch (err) {
      failed.push(name)
      logger.error({ job, step: name, err: summarizeError(err) }, 'clean-up step failed')
    }
  }
  logger.info({ job, ...counts, failed }, 'clean-up done')
  if (failed.length > 0) {
    throw new Error(`${job}: ${failed.join(', ')} failed`)
  }
  return counts
}

export function cleanupCredentials(deps: CleanupDeps): Promise<CleanupCounts> {
  const now = (deps.now ?? (() => new Date()))()
  return runSteps(
    CLEANUP_CREDENTIALS,
    [
      ['sessions', () => deleteExpiredSessions(deps.db, now)],
      ['accountTokens', () => deleteSpentAccountTokens(deps.db, now)],
      ['cacheInvalidations', () => deleteOldCacheInvalidations(deps.db, daysAgo(now, 1))],
    ],
    deps.logger,
  )
}

export async function cleanupIpRetention(deps: CleanupDeps): Promise<CleanupCounts> {
  const now = (deps.now ?? (() => new Date()))()
  // Read once. When the setting cannot be read, nothing is cleared: a failed read must not fall back to deleting sooner.
  const cutoff = daysAgo(now, await readRetentionDays(deps.db, IP_RETENTION))
  return runSteps(
    CLEANUP_IP_RETENTION,
    [
      ['sessionIps', () => clearSessionIps(deps.db, cutoff)],
      ['commentIps', () => clearCommentIps(deps.db, cutoff)],
      ['appPasswordIps', () => clearAppPasswordIps(deps.db, cutoff)],
      ['loginAttempts', () => deleteOldLoginAttempts(deps.db, cutoff)],
      ['auditLogIps', () => clearOldAuditIps(deps.db)],
    ],
    deps.logger,
  )
}

export async function cleanupSpamComments(deps: CleanupDeps): Promise<CleanupCounts> {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = daysAgo(now, await readRetentionDays(deps.db, SPAM_RETENTION))
  return runSteps(CLEANUP_SPAM_COMMENTS, [['spamComments', () => deleteOldSpamComments(deps.db, cutoff)]], deps.logger)
}

/** The clean-up jobs: the queue, when it runs (cron, UTC), and what it does. Spread over the night so they do not start together. */
export const CLEANUP_JOBS = [
  { queue: CLEANUP_CREDENTIALS, cron: '17 3 * * *', run: cleanupCredentials },
  { queue: CLEANUP_IP_RETENTION, cron: '27 3 * * *', run: cleanupIpRetention },
  { queue: CLEANUP_SPAM_COMMENTS, cron: '37 3 * * *', run: cleanupSpamComments },
] as const

/**
 * How the clean-up jobs are queued: tried again twice after ten minutes, and counted as failed after half an hour. They are
 * a schedule's jobs, so they have no payload, and a missed run is not made up for (the next one does the work).
 */
export const CLEANUP_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 600,
  expireInSeconds: 1800,
  retentionSeconds: 24 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
} as const
