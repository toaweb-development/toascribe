import { z } from 'zod'

import { EncryptedValue } from './encrypted.ts'

// The e-mail the system sends (K-284, K-286, K-017): which templates there are, the payload of the `email.send` job, and how
// the job is retried. The api validates a message before it queues it, and the worker validates the job again before it
// sends (typescript §11), both with the schemas here.
//
// A message names a template and gives it data; it never carries finished text. The worker builds the text from the site's
// language and name (mail-render.ts), and the link from PUBLIC_ORIGIN.
//
// The token of a one-time link is a secret. The flows pass it in plain text (`EmailMessage`), and the producer encrypts it
// before the job is stored (`EmailJobPayload`), so the job table and its archive never hold a working link. The worker
// decrypts it just before it renders.

export const EMAIL_TEMPLATE = [
  'password_reset',
  'set_password',
  'email_change',
  'admin_new_user',
  'admin_password_change',
  'account_exists',
  'email_change_notice',
  'security_notice',
  'test',
] as const
export const EmailTemplate = z.enum(EMAIL_TEMPLATE)
export type EmailTemplate = z.infer<typeof EmailTemplate>

/**
 * What a `security_notice` tells the owner of an account has happened (or is about to): the change to their credentials
 * that needed the password (or, for a reset, a link). An e-mail change has its own template (`email_change_notice`).
 * `mfa_reset`, `password_reset_by_admin` and `login_limit_reset` are the ones an operator causes (`toa user mfa-reset`,
 * `reset-password` and `reset-login-limit` with `--notify`): the notice is sent after the change.
 */
export const SECURITY_NOTICE_ACTION = [
  'mfa_added',
  'mfa_removed',
  'recovery_codes_regenerated',
  'password_changed',
  'password_reset',
  'mfa_reset',
  'password_reset_by_admin',
  'login_limit_reset',
] as const
export const SecurityNoticeAction = z.enum(SECURITY_NOTICE_ACTION)
export type SecurityNoticeAction = z.infer<typeof SecurityNoticeAction>

/** How long a one-time link works, in hours (Tor, M0.3). The mail says it, and the flows use it for `account_token.expires_at`. */
export const ONE_TIME_LINK_HOURS = 24

/** The job queue the mail goes through. */
export const EMAIL_QUEUE = 'email.send'

/**
 * How `email.send` jobs are retried and kept (typescript §11: `retryLimit`, `retryBackoff`, an expiry). Seconds, as pg-boss takes them.
 * - A failed send is tried again up to five times, with the wait doubling from 30 s and never longer than 30 min.
 * - A send that has not finished after three minutes is counted as failed (the SMTP timeouts add up to well under that).
 * - A mail still waiting after three hours is dropped: a password-reset mail that arrives the next day helps nobody.
 * - A finished or failed job is kept for a day, for troubleshooting, and then deleted with its payload.
 */
export const EMAIL_JOB_OPTIONS = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 1800,
  expireInSeconds: 180,
  retentionSeconds: 3 * 60 * 60,
  deleteAfterSeconds: 24 * 60 * 60,
} as const

/** Two messages with the same content to the same address within this many seconds are sent once (double click, a flow that ran twice). */
export const EMAIL_DEDUPE_SECONDS = 60

const oneLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value), { message: 'Must be one line, without control characters' })

/** The token of a one-time link, as `generateToken()` makes it: base64url, 256 bits. Longer and shorter ones are refused. */
export const MailToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)

const Recipient = z.email().max(254)
const Username = oneLine(200)

/**
 * The template-specific part, with the secret field's schema as a parameter: the plain token for what a flow passes, the
 * encrypted value for what is stored in the job.
 */
function messages<S extends z.ZodType<string>>(secret: S) {
  return z.discriminatedUnion('template', [
    // Lost password: to the account's own address.
    z.strictObject({
      template: z.literal('password_reset'),
      to: Recipient,
      data: z.strictObject({ username: Username, token: secret }),
    }),
    // A new account: «welcome, choose a password». Also the link of a registration.
    z.strictObject({
      template: z.literal('set_password'),
      to: Recipient,
      data: z.strictObject({ username: Username, token: secret }),
    }),
    // E-mail change: to the NEW address, so that opening the link proves it is the user's.
    z.strictObject({
      template: z.literal('email_change'),
      to: Recipient,
      data: z.strictObject({ username: Username, token: secret }),
    }),
    // Notice to an administrator (K-017): a user was registered or made.
    z.strictObject({
      template: z.literal('admin_new_user'),
      to: Recipient,
      data: z.strictObject({ username: Username, email: Recipient }),
    }),
    // Notice to an administrator (K-017): a user changed or reset a password.
    z.strictObject({
      template: z.literal('admin_password_change'),
      to: Recipient,
      data: z.strictObject({ username: Username }),
    }),
    // Registration or an e-mail change that named an address that already has an account (K-005, K-012). The answer to the
    // request is the same either way, so this mail is how the owner of the address finds out; it holds nothing secret.
    z.strictObject({
      template: z.literal('account_exists'),
      to: Recipient,
      data: z.strictObject({ username: Username }),
    }),
    // To the OLD address when an e-mail change is requested (K-012): the owner can see it and react before it is confirmed.
    z.strictObject({
      template: z.literal('email_change_notice'),
      to: Recipient,
      data: z.strictObject({ username: Username, newEmail: Recipient }),
    }),
    // To the account's own address when its credentials change (M0.3, OWASP ASVS V7.5): a second factor added or removed, new
    // recovery codes, a new password. Sent before the change, so the owner can react. It holds nothing secret.
    z.strictObject({
      template: z.literal('security_notice'),
      to: Recipient,
      data: z.strictObject({ username: Username, action: SecurityNoticeAction }),
    }),
    // POST /system/test-email (K-204): proves that the SMTP settings work.
    z.strictObject({
      template: z.literal('test'),
      to: Recipient,
      data: z.strictObject({ requestedBy: Username }),
    }),
  ])
}

/** What a flow asks for: the token, if there is one, in plain text. Never logged, never stored. */
export const EmailMessage = messages(MailToken)
export type EmailMessage = z.infer<typeof EmailMessage>

/** The `email.send` job's payload: the same, with the token encrypted by the key ring. */
export const EmailJobPayload = messages(EncryptedValue)
export type EmailJobPayload = z.infer<typeof EmailJobPayload>

/**
 * What the token is encrypted for (AES-GCM additional data): this job's template and recipient. A sealed token copied into
 * another job, another template or another address does not decrypt.
 */
export function emailTokenAad(template: EmailTemplate, to: string): string {
  return `email.send:token:${template}:${to.toLowerCase()}`
}

/** What the SMTP password is encrypted for, in the `setting` table. */
export const SMTP_PASSWORD_AAD = 'setting:smtp_password'
