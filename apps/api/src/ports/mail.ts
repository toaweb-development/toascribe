// The seam the account flows (lost password, registration, e-mail change, admin notices) send mail through. The flows call
// `sendMail` and know nothing about queues or SMTP. The job queue and the transport are behind it (M0.3 task 3); until
// they are wired in, `unconfiguredMail` fails loudly rather than dropping a mail.

export interface MailRequest {
  /** The template name, e.g. `password_reset`. The set of names belongs to the mail templates. */
  readonly template: string
  /** The recipient's address. */
  readonly to: string
  /** What the template shows (names, links). Plain strings; a link carries a one-time token, so this is never logged. */
  readonly data: Readonly<Record<string, string>>
}

export interface MailPort {
  /** Queues the mail. Resolves when it is accepted for sending, not when it is delivered. */
  sendMail: (request: MailRequest) => Promise<void>
}

export const unconfiguredMail: MailPort = {
  sendMail() {
    return Promise.reject(new Error('no mail transport is configured'))
  },
}
