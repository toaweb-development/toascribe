// Site-level actions an administrator takes: for now, the test mail (K-204). The mail is sent by the worker, which also marks
// the e-mail as verified when it has gone through (markEmailVerified in @toascribe/install); the api only queues it.
import type { Database } from '@toascribe/db'

import type { SessionAuth } from '../lib/auth-context.ts'
import { TooManyRequestsError } from '../lib/errors.ts'
import type { MailPort } from '../ports/mail.ts'
import { insertAuditEntry } from '../repositories/audit.ts'

/** One test mail per account in this many seconds. The queue enforces it (a throttle on the job), so it holds across restarts and across api instances. */
export const TEST_EMAIL_WINDOW_SECONDS = 30

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
}

export function createSystemService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly mail: MailPort
}): SystemService {
  const { db, clock, mail } = options

  return {
    async sendTestEmail(auth, to, context) {
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
      return { jobId: receipt.jobId }
    },
  }
}
