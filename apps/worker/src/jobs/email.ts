// The `email.send` job (K-284, K-286): validates the payload again, decrypts the one-time token, renders the mail in the
// site's language, and sends it through SMTP. What the log gets: the job id, the template, the domain of the recipient and, on
// a failure, error codes. Never the address, the data or the token (security §8).
import { takeRequestId } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { markEmailVerified } from '@toascribe/install'
import { CoreSettings, EmailJobPayload, openEmailPayload, renderMail } from '@toascribe/shared'
import type { EmailMessage } from '@toascribe/shared'
import type { KeyRing } from '@toascribe/shared'
import type { Logger } from 'pino'

import { recipientDomain, summarizeError } from '../lib/redact.ts'
import { MailConfigError, createSmtpTransport, resolveSmtp } from '../mail/smtp.ts'
import type { MailEnvDefaults, MailSettings, TransportFactory } from '../mail/smtp.ts'
import { readSettings } from '../repositories/settings.ts'

const MailSettingsSchema = CoreSettings.pick({
  blogname: true,
  locale: true,
  mail_from_address: true,
  mail_from_name: true,
  smtp_host: true,
  smtp_port: true,
  smtp_secure: true,
  smtp_username: true,
  smtp_password: true,
})

export interface EmailJobDeps {
  readonly db: Database
  readonly keyRing: KeyRing
  readonly logger: Logger
  /** PUBLIC_ORIGIN. The only thing a link is built from. */
  readonly publicOrigin: string
  readonly mailDefaults: MailEnvDefaults
  /** The clock for `smtp_verified_at` and its audit entry. Replaced in tests. */
  readonly clock?: () => Date
  /** Replaced in tests; the real one talks SMTP. */
  readonly transport?: TransportFactory
}

/** What pg-boss does with a job: `failed` is retried while retries are left, `deadletter` never is (a payload that is wrong stays wrong). */
export interface JobOutcome {
  readonly id: string
  readonly status: 'completed' | 'failed' | 'deadletter'
  readonly output?: Record<string, string | number | boolean>
}

/** What the handler uses of a job. pg-boss's own job (with metadata, for `retryLimit`) fits it. */
export interface EmailJob {
  readonly id: string
  readonly name: string
  readonly data: unknown
  readonly retryCount?: number
  readonly retryLimit?: number
}

function siteNameOf(blogname: string, origin: string): string {
  return blogname.trim() === '' ? new URL(origin).host : blogname
}

/** Handles one job. Never throws: the outcome says what pg-boss should do with it. */
export async function processEmailJob(job: EmailJob, deps: EmailJobDeps): Promise<JobOutcome> {
  // The request that queued the job (M1.8, K-297), so its lines can be found with the site's and the api's.
  const { requestId, data } = takeRequestId(job.data)
  const log = deps.logger.child({ jobId: job.id, queue: job.name, ...(requestId === undefined ? {} : { requestId }) })

  const parsed = EmailJobPayload.safeParse(data)
  if (!parsed.success) {
    // Field names only: the values may hold an address or a sealed token.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(payload)'))]
    log.warn({ fields }, 'e-mail job refused: the payload is not valid')
    return { id: job.id, status: 'deadletter', output: { error: 'invalid_payload', fields: fields.join(',') } }
  }
  const payload = parsed.data
  const meta = { template: payload.template, recipientDomain: recipientDomain(payload.to) }

  let message: EmailMessage
  try {
    message = await openEmailPayload(payload, deps.keyRing)
  } catch (err) {
    log.warn({ ...meta, err: summarizeError(err) }, 'e-mail job refused: the token cannot be decrypted')
    return { id: job.id, status: 'deadletter', output: { error: 'undecryptable' } }
  }

  let settings: MailSettings
  try {
    settings = await readSettings(deps.db, MailSettingsSchema, (key) => {
      log.warn({ key }, 'a stored setting is invalid; the default is used')
    })
  } catch (err) {
    // The database is not answering. The job is tried again.
    log.error({ ...meta, err: summarizeError(err) }, 'e-mail job failed: the settings cannot be read')
    return { id: job.id, status: 'failed', output: { error: 'settings_unavailable' } }
  }
  const siteName = siteNameOf(settings.blogname, deps.publicOrigin)

  let rendered: ReturnType<typeof renderMail>
  try {
    rendered = renderMail(message, { siteName, origin: new URL(deps.publicOrigin).origin, locale: settings.locale })
  } catch (err) {
    log.error({ ...meta, err: summarizeError(err) }, 'e-mail job refused: the template cannot be rendered')
    return { id: job.id, status: 'deadletter', output: { error: 'template_error' } }
  }

  try {
    const smtp = await resolveSmtp(settings, deps.mailDefaults, deps.keyRing, siteName)
    const transport = (deps.transport ?? createSmtpTransport)(smtp, deps.logger)
    try {
      await transport.send({ from: smtp.from, to: message.to, ...rendered })
    } finally {
      transport.close()
    }
  } catch (err) {
    const retriesLeft = (job.retryLimit ?? 0) - (job.retryCount ?? 0) > 0
    const level = err instanceof MailConfigError || !retriesLeft ? 'error' : 'warn'
    log[level](
      { ...meta, attempt: (job.retryCount ?? 0) + 1, willRetry: retriesLeft, err: summarizeError(err) },
      retriesLeft ? 'e-mail not sent; it will be tried again' : 'e-mail not sent; giving up',
    )
    return {
      id: job.id,
      status: 'failed',
      output: { error: err instanceof MailConfigError ? 'mail_config' : 'send_failed' },
    }
  }

  log.info(meta, 'e-mail sent')
  if (message.template !== 'test') {
    return { id: job.id, status: 'completed', output: { sent: true } }
  }
  // A test mail that went out proves the site can send with the settings it used: mark the e-mail as verified (the only writer
  // of `smtp_verified_at`, in @toascribe/install). That happens before the job is reported done, so whoever waits for the job
  // (the setup wizard) finds the field set. It marks only if the settings are still the ones used here. The mail is already sent,
  // so a failure here must not fail the job (a retry would send it again); it is logged and the administrator tests again.
  let verified = false
  try {
    verified = await markEmailVerified(deps.db, {
      sentWith: settings,
      requestedById: message.data.requestedById,
      at: (deps.clock ?? (() => new Date()))(),
      jobId: job.id,
    })
    log.info(
      { ...meta, verified },
      verified ? 'e-mail marked as verified' : 'e-mail settings changed since the test was sent',
    )
  } catch (err) {
    log.warn(
      { ...meta, err: summarizeError(err) },
      'the test mail was sent but the e-mail could not be marked as verified',
    )
  }
  return { id: job.id, status: 'completed', output: { sent: true, verified } }
}

/** The pg-boss handler: one outcome per job, each settled on its own (`perJobResults`). */
export function emailHandler(deps: EmailJobDeps) {
  return async (jobs: EmailJob[]): Promise<JobOutcome[]> => Promise.all(jobs.map((job) => processEmailJob(job, deps)))
}
