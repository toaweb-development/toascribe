import type { AdminNoticeLevel } from './values.ts'

// Admin notices that core code raises (M0.4). One `admin_notice` row per key: raising a notice again replaces its
// level, message and data and clears a dismissal; resolving it deletes the row. The dashboard (M0.5) shows the rows
// whose `dismissed_at` is null to accounts that hold the row's `capability`, with the text from i18n `message_key`.

export interface AdminNoticeDefinition {
  /** Stable machine key, unique per notice. */
  readonly key: string
  readonly level: AdminNoticeLevel
  /** The admin's i18n key for the text. */
  readonly messageKey: string
  /** The capability an account needs to see it. */
  readonly capability: string
  /** Whether the dashboard offers «Avvis». */
  readonly isDismissible: boolean
}

/**
 * The e-mail step of the setup wizard (or `toa core install --skip-email`) was skipped, so the site may not be able to
 * send mail (Tor: «lagres et varsel som kontrollpanelet viser i M0.5»). Resolved when a test mail succeeds later.
 */
export const SETUP_EMAIL_SKIPPED_NOTICE: AdminNoticeDefinition = {
  key: 'setup.email_skipped',
  level: 'warning',
  messageKey: 'notices.setupEmailSkipped',
  capability: 'manage_options',
  isDismissible: true,
}

// Notices that are worked out when the dashboard asks, not stored: the condition is read from the system itself, so they appear
// and go away with it and there is no row to keep in step. The api builds them (apps/api/src/services/notices.ts).

/**
 * The site's e-mail has not passed a test (`smtp_verified_at` is null: never tested, skipped in the setup, or the SMTP settings
 * changed since). An administrator sees it until a test mail passes. It stands in for `setup.email_skipped` while it shows,
 * so the list never has both.
 */
export const EMAIL_NOT_VERIFIED_NOTICE: AdminNoticeDefinition = {
  key: 'email.not_verified',
  level: 'warning',
  messageKey: 'notices.emailNotVerified',
  capability: 'manage_options',
  isDismissible: false,
}

/**
 * `TOASCRIBE_TRUSTED_PROXY` is empty and every request came from the same private address (the api's proxy check is in the
 * `warning` state): the client IP is the proxy's. `data.address` is the address that was seen. It goes when the state is no longer
 * `warning`, which is after a restart with the variable set.
 */
export const PROXY_NOT_TRUSTED_NOTICE: AdminNoticeDefinition = {
  key: 'proxy.not_trusted',
  level: 'warning',
  messageKey: 'notices.proxyNotTrusted',
  capability: 'manage_options',
  isDismissible: false,
}
