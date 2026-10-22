// The seam the account flows (lost password, registration, e-mail change, admin notices, the test mail) send mail through.
// The flows call `sendMail` and know nothing about queues or SMTP: the job queue and the transport are behind it
// (adapters/mail-queue.ts in the api, the `email.send` handler in the worker). `unconfiguredMail` is for a process that
// has no queue: it fails loudly rather than dropping a mail.
import type { EmailMessage } from '@toascribe/shared'

/**
 * A message as a flow gives it: a template name, the recipient, and the data of the template (see EmailMessage in
 * @toascribe/shared for what each template takes). A one-time token is passed in plain text and is encrypted before it is
 * stored; it is never logged.
 */
export type MailRequest = EmailMessage

export interface MailReceipt {
  /**
   * The queue's id for the mail. Null when nothing was queued because the same message was queued a moment ago (the
   * duplicate rule), or because a throttle the caller asked for was hit.
   */
  readonly jobId: string | null
}

export interface MailOptions {
  /** At most one mail with this key per `seconds`; the next one is not queued and gets `jobId: null`. A key holds letters, digits, `.`, `-`, `_`. */
  readonly throttle?: { readonly key: string; readonly seconds: number }
}

export interface MailPort {
  /** Queues the mail. Resolves when it is accepted for sending, not when it is delivered. Rejects if the message is not valid. */
  sendMail: (request: MailRequest, options?: MailOptions) => Promise<MailReceipt>
}

export const unconfiguredMail: MailPort = {
  sendMail() {
    return Promise.reject(new Error('no mail transport is configured'))
  },
}
