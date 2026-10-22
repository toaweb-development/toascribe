// Registers the worker's queues, handlers and schedules. Only the worker does this (typescript §11, AGENTS.md): the api only
// queues mail, and never supervises or schedules.
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE } from '@toascribe/shared'
import type { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { CLEANUP_JOBS, CLEANUP_QUEUE_OPTIONS } from './cleanup.ts'
import type { CleanupDeps } from './cleanup.ts'
import { emailHandler } from './email.ts'
import type { EmailJobDeps } from './email.ts'

export interface JobsOptions {
  readonly email: EmailJobDeps
  readonly cleanup: CleanupDeps
  /** How often a worker looks for a new job, in seconds, on every queue. Default: 2 for mail (pg-boss's own), 30 for the clean-up. Tests set it low. */
  readonly pollingSeconds?: number
}

/** The cron schedules registered, for the tests and the log. */
export const SCHEDULE_TIMEZONE = 'UTC'

export async function registerJobs(boss: PgBoss, options: JobsOptions, logger: Logger): Promise<void> {
  // E-mail. Three at a time: each holds an SMTP connection for a moment, and a mail server should not be hit harder.
  await boss.createQueue(EMAIL_QUEUE, EMAIL_JOB_OPTIONS)
  await boss.work(
    EMAIL_QUEUE,
    {
      batchSize: 1,
      localConcurrency: 3,
      includeMetadata: true,
      perJobResults: true,
      ...(options.pollingSeconds === undefined ? {} : { pollingIntervalSeconds: options.pollingSeconds }),
    },
    emailHandler(options.email),
  )

  // Clean-up: a queue, a worker and a cron schedule each. `schedule()` replaces a schedule with the same name, so a changed
  // time takes effect at the next start and nothing piles up.
  for (const job of CLEANUP_JOBS) {
    await boss.createQueue(job.queue, CLEANUP_QUEUE_OPTIONS)
    await boss.work(job.queue, { batchSize: 1, pollingIntervalSeconds: options.pollingSeconds ?? 30 }, async () => {
      await job.run(options.cleanup)
    })
    await boss.schedule(job.queue, job.cron, null, { tz: SCHEDULE_TIMEZONE })
  }
  logger.info(
    { queues: [EMAIL_QUEUE, ...CLEANUP_JOBS.map((job) => job.queue)], schedules: CLEANUP_JOBS.length },
    'jobs registered',
  )
}
