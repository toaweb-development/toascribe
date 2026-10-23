// The api's side of the `email.send` job (K-284, K-286): the `sendMail` seam, backed by pg-boss. It checks the message against
// the shared schema, encrypts the one-time token, and puts the job in the queue with the retry and expiry rules of
// EMAIL_JOB_OPTIONS. The worker does the rest (apps/worker/src/jobs/email.ts).
//
// pg-boss is started on the first mail, not at start-up: the api serves without a reachable queue (as it serves /api/health
// without a database), and a mail then fails with a clear error instead of stopping the whole process. The api never
// supervises or schedules (only the worker does, AGENTS.md) and uses the app role, so no DDL runs here.
import { createHash } from 'node:crypto'

import { PGBOSS_APP_OPTIONS } from '@toascribe/db'
import { EMAIL_DEDUPE_SECONDS, EMAIL_JOB_OPTIONS, EMAIL_QUEUE, EmailMessage, sealEmailMessage } from '@toascribe/shared'
import type { KeyRing } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import type { MailJobState, MailOptions, MailPort, MailReceipt, MailRequest } from '../ports/mail.ts'

export interface MailQueueDeps {
  /** DATABASE_URL: the app role. */
  readonly connectionString: string
  readonly keyRing: KeyRing
  readonly logger: Logger
}

export interface MailQueue extends MailPort {
  /** Stops pg-boss if it was started. Call it on shutdown, before the pool of the api is ended. */
  stop: () => Promise<void>
}

/** The same content to the same address gives the same key, so a repeat inside EMAIL_DEDUPE_SECONDS is dropped by the queue. */
function contentKey(message: EmailMessage): string {
  const data = Object.fromEntries(Object.entries(message.data).sort(([a], [b]) => a.localeCompare(b)))
  const digest = createHash('sha256')
    .update(JSON.stringify([message.template, message.to.toLowerCase(), data]))
    .digest('hex')
  return `email.${digest}`
}

export function createMailQueue(deps: MailQueueDeps): MailQueue {
  const { logger } = deps
  let booting: Promise<PgBoss> | undefined

  async function boot(): Promise<PgBoss> {
    const boss = new PgBoss({
      ...PGBOSS_APP_OPTIONS,
      connectionString: deps.connectionString,
      application_name: 'toascribe-api-queue',
      max: 2,
      supervise: false,
      schedule: false,
      instanceName: 'api',
    })
    // Without a listener an 'error' event would throw and crash the process.
    boss.on('error', (err) => {
      logger.error({ err }, 'pg-boss error')
    })
    try {
      await boss.start()
      // Idempotent (the worker creates it too); a send to a queue that does not exist yet would fail.
      await boss.createQueue(EMAIL_QUEUE, EMAIL_JOB_OPTIONS)
    } catch (err) {
      await boss.stop({ graceful: false }).catch(() => undefined)
      throw err
    }
    return boss
  }

  function ready(): Promise<PgBoss> {
    booting ??= boot().catch((err: unknown) => {
      booting = undefined // try again on the next mail
      throw err
    })
    return booting
  }

  return {
    async sendMail(request: MailRequest, options?: MailOptions): Promise<MailReceipt> {
      const parsed = EmailMessage.safeParse(request)
      if (!parsed.success) {
        // Field names only: the values may hold a token or an address.
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(message)'))]
        throw new Error(`Invalid e-mail message: ${fields.join(', ')}`)
      }
      const message = parsed.data
      const payload = await sealEmailMessage(message, deps.keyRing)
      const boss = await ready()
      const jobId = await boss.send(EMAIL_QUEUE, payload, {
        ...EMAIL_JOB_OPTIONS,
        ...(options?.retryLimit === undefined ? {} : { retryLimit: options.retryLimit }),
        ...(options?.retentionSeconds === undefined ? {} : { retentionSeconds: options.retentionSeconds }),
        ...(options?.throttle === undefined
          ? { singletonKey: contentKey(message), singletonSeconds: EMAIL_DEDUPE_SECONDS }
          : { singletonKey: options.throttle.key, singletonSeconds: options.throttle.seconds }),
      })
      // The job id, the template and the domain of the recipient: no address, no data, no token (security §8).
      logger.info(
        { jobId, template: message.template, recipientDomain: message.to.split('@').pop() },
        jobId === null ? 'e-mail not queued: duplicate or throttled' : 'e-mail queued',
      )
      return { jobId }
    },

    async jobState(jobId: string): Promise<MailJobState | null> {
      const boss = await ready()
      const [job] = await boss.findJobs(EMAIL_QUEUE, { id: jobId, limit: 1 })
      return job === undefined ? null : { state: job.state, output: job.output }
    },

    async stop() {
      const started = booting
      booting = undefined
      if (started !== undefined) {
        const boss = await started.catch(() => undefined)
        await boss?.stop({ graceful: true })
      }
    },
  }
}
