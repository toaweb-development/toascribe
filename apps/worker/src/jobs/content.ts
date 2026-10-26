// The content jobs (M1.1): the scheduler every minute (K-063, K-064) and the daily purge of the trash (K-062). Both are safe to run
// twice and on two workers at once: the statements (repositories/content.ts) lock the rows they change and check them again.
import type { Database } from '@toascribe/db'
import type { Logger } from 'pino'

import { summarizeError } from '../lib/redact.ts'
import { publishDue, purgeTrash, unpublishDue } from '../repositories/content.ts'

export const CONTENT_SCHEDULER = 'content.scheduler'
export const CONTENT_TRASH_PURGE = 'content.trash-purge'

/** WordPress' EMPTY_TRASH_DAYS: a trashed item is deleted for good after 30 days. */
export const TRASH_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface ContentJobDeps {
  readonly db: Database
  readonly logger: Logger
  /** The clock. Tests set it. */
  readonly now?: () => Date
}

/** Publishes the scheduled items that are due, then unpublishes the published ones whose time has passed. */
export async function runScheduler(deps: ContentJobDeps): Promise<{ published: number; unpublished: number }> {
  const now = (deps.now ?? (() => new Date()))()
  try {
    const published = await publishDue(deps.db, now, CONTENT_SCHEDULER)
    const unpublished = await unpublishDue(deps.db, now, CONTENT_SCHEDULER)
    if (published + unpublished > 0) {
      deps.logger.info({ job: CONTENT_SCHEDULER, published, unpublished }, 'scheduled content changed')
    }
    return { published, unpublished }
  } catch (err) {
    deps.logger.error({ job: CONTENT_SCHEDULER, err: summarizeError(err) }, 'content scheduler failed')
    throw err
  }
}

/** Deletes what has been in the trash for more than TRASH_DAYS. */
export async function runTrashPurge(deps: ContentJobDeps): Promise<{ deleted: number }> {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY_MS)
  try {
    const deleted = await purgeTrash(deps.db, cutoff, now, CONTENT_TRASH_PURGE)
    deps.logger.info({ job: CONTENT_TRASH_PURGE, deleted }, 'trash purge done')
    return { deleted }
  } catch (err) {
    deps.logger.error({ job: CONTENT_TRASH_PURGE, err: summarizeError(err) }, 'trash purge failed')
    throw err
  }
}

/**
 * The scheduler's queue: `exclusive` (at most one job queued or active, so a slow run never piles up), no retry (the next minute
 * does the work), and a job that hangs expires before the next one is due.
 */
export const SCHEDULER_QUEUE_OPTIONS = {
  policy: 'exclusive',
  retryLimit: 0,
  expireInSeconds: 50,
  retentionSeconds: 60 * 60,
  deleteAfterSeconds: 60 * 60,
} as const

export const CONTENT_JOBS = [
  { queue: CONTENT_SCHEDULER, cron: '* * * * *', run: runScheduler },
  { queue: CONTENT_TRASH_PURGE, cron: '47 3 * * *', run: runTrashPurge },
] as const
