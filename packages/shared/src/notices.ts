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
