// The media jobs' producer (M1.2): the api queues a job after an upload, a replacement, an edit or «Lag bildestørrelser på nytt», and
// `toa media regenerate` queues them from the command line. Sends only (no supervision, no schedules); the worker takes them. The queue
// is `stately` with a key per file and kind, so a file never has two jobs of the same kind waiting.
import { withRequestId } from './request-context.ts'
import { MEDIA_JOB_OPTIONS, MEDIA_QUEUE, MediaJob } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { PGBOSS_APP_OPTIONS } from './pgboss.ts'

/** The queue as the api, the cli and the worker create it (the first one to start makes it; the options are the same). */
export const MEDIA_QUEUE_OPTIONS = { ...MEDIA_JOB_OPTIONS, policy: 'stately' } as const

export interface MediaProducer {
  /** Queues the job once (a second one for the same file and kind while one waits is dropped). Checked against MediaJob first. */
  send: (job: MediaJob) => Promise<void>
  stop: () => Promise<void>
}

export function createMediaProducer(options: {
  /** DATABASE_URL: the app role. */
  readonly connectionString: string
  /** Names the connection and the pg-boss instance, e.g. `toascribe-api-media`. */
  readonly applicationName: string
  readonly logger: Logger
}): MediaProducer {
  let booting: Promise<PgBoss> | undefined

  async function boot(): Promise<PgBoss> {
    const boss = new PgBoss({
      ...PGBOSS_APP_OPTIONS,
      connectionString: options.connectionString,
      application_name: options.applicationName,
      max: 1,
      supervise: false,
      schedule: false,
      instanceName: options.applicationName,
    })
    boss.on('error', (err) => {
      options.logger.error({ err }, 'pg-boss error')
    })
    try {
      await boss.start()
      await boss.createQueue(MEDIA_QUEUE, MEDIA_QUEUE_OPTIONS)
    } catch (err) {
      await boss.stop({ graceful: false }).catch(() => undefined)
      throw err
    }
    return boss
  }

  function ready(): Promise<PgBoss> {
    booting ??= boot().catch((err: unknown) => {
      booting = undefined
      throw err
    })
    return booting
  }

  return {
    async send(job) {
      const payload = MediaJob.parse(job)
      const boss = await ready()
      await boss.send(MEDIA_QUEUE, withRequestId(payload), {
        ...MEDIA_JOB_OPTIONS,
        singletonKey: `${payload.kind}:${payload.mediaId}`,
      })
    },
    async stop() {
      const running = booting
      booting = undefined
      if (running !== undefined) {
        const boss = await running.catch(() => undefined)
        await boss?.stop({ graceful: true })
      }
    },
  }
}
