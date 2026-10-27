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
import { BACKUP_CRON, BACKUP_DAILY, BACKUP_QUEUE_OPTIONS, dailyBackupOn, runDailyBackup } from './backup.ts'
import type { BackupJobDeps } from './backup.ts'
import {
  UPDATE_CHECK,
  UPDATE_CHECK_CRON,
  UPDATE_QUEUE_OPTIONS,
  runDailyUpdateCheck,
  updateCheckDue,
} from './updates.ts'
import type { UpdateJobDeps } from './updates.ts'

export interface JobsOptions {
  readonly email: EmailJobDeps
  readonly cleanup: CleanupDeps
  /** The content scheduler and the trash purge (M1.1). */
  readonly content: ContentJobDeps
  /** The media jobs (M1.2): sizes, edits and regeneration with sharp. */
  readonly media: MediaJobDeps
  /** The daily backup (M1.7), when toascribe.toml turns it on. */
  readonly backup: BackupJobDeps
  /** The daily update check (M1.7, K-290). */
  readonly updates: UpdateJobDeps
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
  // Media: one image at a time (a decode holds up to the pixel limit in memory, and the worker has 1 GB), and every five minutes a
  // sweep that queues the images whose job was lost between the upload and the queue.
  await boss.createQueue(MEDIA_QUEUE, MEDIA_QUEUE_OPTIONS)
  await boss.work(
    MEDIA_QUEUE,
    { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: options.pollingSeconds ?? 2 },
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
  // The daily backup: scheduled when toascribe.toml says so, and the schedule removed when it does not (read at each start).
  await boss.createQueue(BACKUP_DAILY, BACKUP_QUEUE_OPTIONS)
  await boss.updateQueue(BACKUP_DAILY, BACKUP_QUEUE_OPTIONS) // a queue made before the options changed takes them too
  await boss.work(BACKUP_DAILY, { batchSize: 1, pollingIntervalSeconds: options.pollingSeconds ?? 60 }, async () => {
    await runDailyBackup(options.backup)
  })
  if (dailyBackupOn(options.backup)) await boss.schedule(BACKUP_DAILY, BACKUP_CRON, null, { tz: SCHEDULE_TIMEZONE })
  else await boss.unschedule(BACKUP_DAILY)
  // The update check: scheduled unless the server turned it off, and run at once when the last one is a day old.
  await boss.createQueue(UPDATE_CHECK, UPDATE_QUEUE_OPTIONS)
  await boss.work(UPDATE_CHECK, { batchSize: 1, pollingIntervalSeconds: options.pollingSeconds ?? 60 }, async () => {
    await runDailyUpdateCheck(options.updates)
  })
  if (options.updates.serverAllows) {
    await boss.schedule(UPDATE_CHECK, UPDATE_CHECK_CRON, null, { tz: SCHEDULE_TIMEZONE })
    if (await updateCheckDue(options.updates.db, options.updates.now?.() ?? new Date())) {
      await boss.send(UPDATE_CHECK, null, { singletonKey: UPDATE_CHECK })
    }
  } else {
    await boss.unschedule(UPDATE_CHECK)
  }
  logger.info(
    {
      queues: [
        EMAIL_QUEUE,
        ...CLEANUP_JOBS.map((job) => job.queue),
        ...CONTENT_JOBS.map((job) => job.queue),
        MEDIA_QUEUE,
        MEDIA_SWEEP,
        BACKUP_DAILY,
        UPDATE_CHECK,
      ],
      schedules: CLEANUP_JOBS.length + CONTENT_JOBS.length + 1,
    },
    'jobs registered',
  )
}
