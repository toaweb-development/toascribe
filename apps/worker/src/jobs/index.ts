// Registers the worker's queues, handlers and schedules. Only the worker does this (typescript §11, AGENTS.md): the api only
// queues mail, and never supervises or schedules.
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE, MEDIA_QUEUE } from '@toascribe/shared'
import type { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { CLEANUP_JOBS, CLEANUP_QUEUE_OPTIONS } from './cleanup.ts'
import type { CleanupDeps } from './cleanup.ts'
import { CONTENT_JOBS, CONTENT_SCHEDULER, SCHEDULER_QUEUE_OPTIONS } from './content.ts'
import type { ContentJobDeps } from './content.ts'
import { emailHandler } from './email.ts'
import { MEDIA_QUEUE_OPTIONS, MEDIA_SWEEP, runMediaJob, sweepPending } from './media.ts'
import type { MediaJobDeps } from './media.ts'
import type { EmailJobDeps } from './email.ts'

export interface JobsOptions {
  readonly email: EmailJobDeps
  readonly cleanup: CleanupDeps
  /** The content scheduler and the trash purge (M1.1). */
  readonly content: ContentJobDeps
  /** The media jobs (M1.2): sizes, edits and regeneration with sharp. */
  readonly media: MediaJobDeps
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
  // Content: the scheduler every minute and the trash purge at night. One worker per queue at a time; the statements themselves
  // are safe on two workers at once (jobs/content.ts).
  for (const job of CONTENT_JOBS) {
    await boss.createQueue(job.queue, job.queue === CONTENT_SCHEDULER ? SCHEDULER_QUEUE_OPTIONS : CLEANUP_QUEUE_OPTIONS)
    await boss.work(job.queue, { batchSize: 1, pollingIntervalSeconds: options.pollingSeconds ?? 10 }, async () => {
      await job.run(options.content)
    })
    await boss.schedule(job.queue, job.cron, null, { tz: SCHEDULE_TIMEZONE })
  }
  // Media: two images at a time (each decode holds up to the pixel limit in memory), and every five minutes a sweep that queues the
  // images whose job was lost between the upload and the queue.
  await boss.createQueue(MEDIA_QUEUE, MEDIA_QUEUE_OPTIONS)
  await boss.work(
    MEDIA_QUEUE,
    { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: options.pollingSeconds ?? 2 },
    async ([job]) => {
      if (job !== undefined) {
        await runMediaJob(options.media, job.data)
      }
    },
  )
  await boss.createQueue(MEDIA_SWEEP, CLEANUP_QUEUE_OPTIONS)
  await boss.work(MEDIA_SWEEP, { batchSize: 1, pollingIntervalSeconds: options.pollingSeconds ?? 30 }, async () => {
    await sweepPending(options.media, boss)
  })
  await boss.schedule(MEDIA_SWEEP, '*/5 * * * *', null, { tz: SCHEDULE_TIMEZONE })
  logger.info(
    {
      queues: [
        EMAIL_QUEUE,
        ...CLEANUP_JOBS.map((job) => job.queue),
        ...CONTENT_JOBS.map((job) => job.queue),
        MEDIA_QUEUE,
        MEDIA_SWEEP,
      ],
      schedules: CLEANUP_JOBS.length + CONTENT_JOBS.length + 1,
    },
    'jobs registered',
  )
}
