// The producer side of the `email.send` job (K-284, K-286) for a process that is not the api: the cli, and later the setup
// service. It checks the message against the shared schema and puts the job in the queue with the retry and expiry rules of
// EMAIL_JOB_OPTIONS; the worker sends it (apps/worker/src/jobs/email.ts). It is the same job, and the same duplicate rule,
// as the api's adapter (apps/api/src/adapters/mail-queue.ts), which stays as it is.
//
// A caller that has no key ring can only queue a message without a token (a notice). A message with a one-time token needs
// `keyRing`, because the token is encrypted before the job is stored; without one the producer refuses it rather than store
// the token in the clear.
//
// pg-boss is started on the first mail, as the app role, with PGBOSS_APP_OPTIONS (no DDL), and never supervises or schedules
// (only the worker does, AGENTS.md). Call `stop()` when the process is done, or its pool keeps the process alive.
import { withRequestId } from './request-context.ts'
import { createHash } from 'node:crypto'

import { EMAIL_DEDUPE_SECONDS, EMAIL_JOB_OPTIONS, EMAIL_QUEUE, EmailMessage, sealEmailMessage } from '@toascribe/shared'
import type { KeyRing } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'

import { PGBOSS_APP_OPTIONS } from './pgboss.ts'

export interface MailProducerOptions {
  /** DATABASE_URL: the app role. */
  readonly connectionString: string
  /** Names the connection in pg_stat_activity and the pg-boss instance, for example `toascribe-cli`. */
  readonly applicationName: string
  readonly logger: Logger
  /** Only needed for a message with a one-time token. */
  readonly keyRing?: KeyRing
}

export interface MailProducerReceipt {
  /** The queue's id for the mail; null when the same message was queued within EMAIL_DEDUPE_SECONDS. */
  readonly jobId: string | null
}

export interface MailProducer {
  /** Queues the mail. Resolves when it is accepted for sending, not when it is delivered. Rejects for a message that is not valid. */
  sendMail: (message: EmailMessage) => Promise<MailProducerReceipt>
  /** Stops pg-boss if it was started. */
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

/** For a process without a key: a message with a token fails here, before anything is stored. */
const NO_KEY_RING: KeyRing = {
  currentVersion: 0,
  versions: [],
  encrypt: () =>
    Promise.reject(new Error('this process has no encryption key, so it cannot queue a message with a token')),
  decrypt: () => Promise.reject(new Error('this process has no encryption key')),
}

export function createMailProducer(options: MailProducerOptions): MailProducer {
  const { logger } = options
  let booting: Promise<PgBoss> | undefined

  async function boot(): Promise<PgBoss> {
    const boss = new PgBoss({
      ...PGBOSS_APP_OPTIONS,
      connectionString: options.connectionString,
      application_name: options.applicationName,
      max: 2,
      supervise: false,
      schedule: false,
      instanceName: options.applicationName,
    })
    // Without a listener an 'error' event would throw and crash the process.
    boss.on('error', (err) => {
      logger.error({ err }, 'pg-boss error')
    })
    try {
      await boss.start()
      // Idempotent (the worker and the api create it too); a send to a queue that does not exist yet would fail.
      await boss.createQueue(EMAIL_QUEUE, EMAIL_JOB_OPTIONS)
    } catch (err) {
      await boss.stop({ graceful: false }).catch(() => undefined)
      throw err
    }
    return boss
  }

  return {
    async sendMail(request) {
      const parsed = EmailMessage.safeParse(request)
      if (!parsed.success) {
        // Field names only: the values may hold a token or an address.
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(message)'))]
        throw new Error(`Invalid e-mail message: ${fields.join(', ')}`)
      }
      const message = parsed.data
      const payload = await sealEmailMessage(message, options.keyRing ?? NO_KEY_RING)
      booting ??= boot().catch((err: unknown) => {
        booting = undefined
        throw err
      })
      const boss = await booting
      const jobId = await boss.send(EMAIL_QUEUE, withRequestId(payload), {
        ...EMAIL_JOB_OPTIONS,
        singletonKey: contentKey(message),
        singletonSeconds: EMAIL_DEDUPE_SECONDS,
      })
      // The job id, the template and the domain of the recipient: no address, no data, no token (security §8).
      logger.info(
        { jobId, template: message.template, recipientDomain: message.to.split('@').pop() },
        jobId === null ? 'e-mail not queued: duplicate' : 'e-mail queued',
      )
      return { jobId }
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
