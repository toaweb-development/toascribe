// Site-level actions an administrator takes: for now, the test mail (K-204).
import { resolveAdminNotice, writeSetting } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { CoreSettings, SETUP_EMAIL_SKIPPED_NOTICE } from '@toascribe/shared'
import type { Logger } from 'pino'

import type { SessionAuth } from '../lib/auth-context.ts'
import { TooManyRequestsError } from '../lib/errors.ts'
import type { MailPort } from '../ports/mail.ts'
import { insertAuditEntry } from '../repositories/audit.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'

/** One test mail per account in this many seconds. The queue enforces it (a throttle on the job), so it holds across restarts and across api instances. */
export const TEST_EMAIL_WINDOW_SECONDS = 30

/** How often, and for how long, the api asks the queue whether a test mail has been sent. The worker takes seconds; a stuck queue is given up on. */
export const TEST_EMAIL_WATCH_POLL_MS = 2000
export const TEST_EMAIL_WATCH_TIMEOUT_MS = 120_000

/** The settings that decide whether mail goes out: a test counts for exactly these. */
const EmailSettings = CoreSettings.pick({
  smtp_host: true,
  smtp_port: true,
  smtp_secure: true,
  smtp_username: true,
  smtp_password: true,
  mail_from_address: true,
  mail_from_name: true,
})

export interface SystemService {
  /**
   * Queues a test mail to `to`, or to the caller's own address when none is given. Returns the queue's job id.
   * Throws TooManyRequestsError when this account sent one in the last TEST_EMAIL_WINDOW_SECONDS.
   */
  sendTestEmail: (
    auth: SessionAuth,
    to: string | undefined,
    context: { readonly ip: string | null; readonly requestId: string | undefined },
  ) => Promise<{ readonly jobId: string }>
  /** Resolves when no test mail is being watched any more (for tests, and for a clean shutdown). */
  idle: () => Promise<void>
}

export function createSystemService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly mail: MailPort
  readonly logger: Logger
  /** Tests make these short. */
  readonly watch?: { readonly pollMs: number; readonly timeoutMs: number }
}): SystemService {
  const { db, clock, mail, logger } = options
  const pollMs = options.watch?.pollMs ?? TEST_EMAIL_WATCH_POLL_MS
  const timeoutMs = options.watch?.timeoutMs ?? TEST_EMAIL_WATCH_TIMEOUT_MS
  const watching = new Set<Promise<void>>()

  /**
   * A test mail that went through proves the site can send mail: it sets `smtp_verified_at` (what the «e-post ikke testet» notice
   * of the dashboard reads) and resolves the setup's «e-post hoppet over» notice. It counts only for the settings that were saved when
   * the test was queued: if they changed meanwhile, the answer is about other settings and nothing is marked. A failed test marks
   * nothing. The api sees the end of the job through the queue; if it restarts first, the administrator sends another.
   */
  async function markVerifiedWhenSent(
    jobId: string,
    tested: string,
    actor: { readonly id: string; readonly username: string },
  ): Promise<void> {
    const jobState = mail.jobState?.bind(mail)
    if (jobState === undefined) {
      return
    }
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const job = await jobState(jobId)
      if (job?.state === 'completed') {
        break
      }
      if (job === null || job.state === 'failed' || job.state === 'cancelled' || Date.now() >= deadline) {
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs).unref())
    }
    await inTransaction(db, async (tx) => {
      if (JSON.stringify(await readSettings(tx, EmailSettings)) !== tested) {
        return
      }
      const at = clock()
      await writeSetting(tx, 'smtp_verified_at', at.toISOString())
      await resolveAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE.key)
      await insertAuditEntry(tx, {
        actorType: 'account',
        actor: actor.username,
        accountId: actor.id,
        action: 'system.email_verified',
        objectType: 'system',
        source: 'api',
        ip: null,
        at,
      })
    })
  }

  return {
    idle: async () => {
      await Promise.all([...watching])
    },

    async sendTestEmail(auth, to, context) {
      const tested = JSON.stringify(await readSettings(db, EmailSettings))
      const recipient = to ?? auth.account.email
      const receipt = await mail.sendMail(
        { template: 'test', to: recipient, data: { requestedBy: auth.account.username } },
        // Per account, not per address: the point is to stop one administrator from using the form to send mail in bulk.
        { throttle: { key: `test-email.${auth.account.id}`, seconds: TEST_EMAIL_WINDOW_SECONDS } },
      )
      if (receipt.jobId === null) {
        throw new TooManyRequestsError(
          TEST_EMAIL_WINDOW_SECONDS,
          'A test mail was sent a moment ago. Wait before sending another.',
        )
      }
      // An administrative action (security §8). The address is not stored, only its domain.
      await insertAuditEntry(db, {
        actorType: 'account',
        actor: auth.account.username,
        accountId: auth.account.id,
        action: 'system.test_email',
        objectType: 'system',
        newValue: { recipientDomain: recipient.split('@').pop() ?? '', jobId: receipt.jobId },
        ...(context.requestId === undefined ? {} : { correlationId: context.requestId }),
        source: 'api',
        ip: context.ip,
        at: clock(),
      })
      const watch = markVerifiedWhenSent(receipt.jobId, tested, {
        id: auth.account.id,
        username: auth.account.username,
      }).catch((err: unknown) => {
        logger.warn({ err, jobId: receipt.jobId }, 'could not follow the test mail to see whether it was sent')
      })
      watching.add(watch)
      void watch.finally(() => watching.delete(watch))
      return { jobId: receipt.jobId }
    },
  }
}
