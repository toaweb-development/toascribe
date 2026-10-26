// The media jobs' producer (M1.2): a pg-boss of its own in the api, as the mail queue has, which only sends (no supervision, no
// schedules). The queue is `stately` with a key per file and kind, so a file never has two jobs of the same kind waiting.
import { PGBOSS_APP_OPTIONS } from '@toascribe/db'
import { MEDIA_JOB_OPTIONS, MEDIA_QUEUE, MediaJob } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import type { MediaJobPort } from '../ports/media-jobs.ts'

export interface MediaQueue extends MediaJobPort {
  stop: () => Promise<void>
}

/** The queue as both the api and the worker create it (the first one to start makes it; the options are the same). */
export const MEDIA_QUEUE_OPTIONS = { ...MEDIA_JOB_OPTIONS, policy: 'stately' } as const

export function createMediaQueue(deps: { readonly connectionString: string; readonly logger: Logger }): MediaQueue {
  let booting: Promise<PgBoss> | undefined

  async function boot(): Promise<PgBoss> {
    const boss = new PgBoss({
      ...PGBOSS_APP_OPTIONS,
      connectionString: deps.connectionString,
      application_name: 'toascribe-api-media',
      max: 1,
      supervise: false,
      schedule: false,
      instanceName: 'api-media',
    })
    boss.on('error', (err) => {
      deps.logger.error({ err }, 'pg-boss error')
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
      await boss.send(MEDIA_QUEUE, payload, {
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
