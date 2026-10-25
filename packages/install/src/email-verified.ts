// «E-post testet»: the one place that writes `smtp_verified_at` when a test mail has gone through (M0.5, Tor's decision).
// The worker calls it after it has sent a `test` mail; nothing else marks the e-mail as verified (a test reads the sources).
// The only other write of the field is the wizard's `saveEmail`, which clears it, in `service.ts`.
import { lockInstall, resolveAdminNotice } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { CoreSettings, SETUP_EMAIL_SKIPPED_NOTICE } from '@toascribe/shared'
import type { z } from 'zod'

import { findAccountById, insertAudit, readSettings, writeSettings } from './repository.ts'

/** The settings that decide whether mail goes out: a test counts for exactly these. */
export const EmailSettings = CoreSettings.pick({
  smtp_host: true,
  smtp_port: true,
  smtp_secure: true,
  smtp_username: true,
  smtp_password: true,
  mail_from_address: true,
  mail_from_name: true,
})
export type EmailSettings = z.infer<typeof EmailSettings>

export interface EmailVerifiedInput {
  /**
   * The e-mail settings the worker sent the test mail with (it read them just before sending). Other keys are ignored. The mail
   * counts only if the stored settings are still these; the SMTP password is the stored, encrypted value, which changes whenever
   * it is saved again. Never put it in a job's data or a log line.
   */
  readonly sentWith: EmailSettings
  /**
   * The `requestedById` of the test mail: the id of the account that asked, or undefined for the wizard's test (no account asked).
   * The audit entry names the account by id and its username now, so a username changed after the mail was queued does not matter.
   */
  readonly requestedById: string | undefined
  readonly at: Date
  /** The worker's job id, for the audit entry. */
  readonly jobId: string
}

/**
 * A test mail went through: the site can send mail with these settings. Sets `smtp_verified_at` (what the dashboard's «e-post ikke
 * testet» notice and the wizard's e-mail step read), resolves the wizard's «e-post hoppet over» notice and writes the audit entry
 * `system.email_verified` (no address: only who asked and the job id). Does all of it, or nothing:
 * - nothing when the stored e-mail settings are no longer `sentWith` (they were saved again after the mail was sent, so the answer
 *   is about other settings; the administrator tests again);
 * - it does not matter whether the site is installed: the wizard's test and the later ones are the same fact. The install lock is
 *   held, so it never runs half-way through a wizard save or the install.
 * Returns whether it marked.
 */
export async function markEmailVerified(db: Database, input: EmailVerifiedInput): Promise<boolean> {
  const sentWith = JSON.stringify(EmailSettings.parse(input.sentWith))
  return db.transaction(async (tx) => {
    await lockInstall(tx)
    if (JSON.stringify(await readSettings(tx, EmailSettings)) !== sentWith) {
      return false
    }
    await writeSettings(tx, [['smtp_verified_at', input.at.toISOString()]])
    await resolveAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE.key)
    // An account deleted since the mail was queued is no longer there to name: the entry is the system's.
    const requester = input.requestedById === undefined ? undefined : await findAccountById(tx, input.requestedById)
    await insertAudit(tx, {
      actorType: requester === undefined ? 'system' : 'account',
      actor: requester?.username ?? 'email.send',
      accountId: requester?.id ?? null,
      action: 'system.email_verified',
      objectType: 'system',
      newValue: { jobId: input.jobId },
      source: 'job',
      ip: null,
      at: input.at,
    })
    return true
  })
}
