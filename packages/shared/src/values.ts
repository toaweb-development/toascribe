import { z } from 'zod'

// Fixed value sets of the data model (docs/DATAMODEL.md). Each list is the single source for three things: the TS union,
// the Zod schema the API validates with, and the named CHECK constraint in @toascribe/db (`col IN (...)`). A test in
// packages/db compares every list with the CHECK in the database, so the three cannot drift. Adding a value is a
// migration (the CHECK changes); removing one needs the rows that use it migrated first.
//
// Values are stable machine strings (WordPress names where WordPress has one), never screen text: labels come from i18n.

/** content.status: visibility (WordPress post_status). `workflow_state` is the editorial step and never publishes. */
export const CONTENT_STATUS = ['draft', 'pending', 'future', 'publish', 'private', 'trash'] as const
export const ContentStatus = z.enum(CONTENT_STATUS)
export type ContentStatus = z.infer<typeof ContentStatus>

/** content.status_before_trash: what «Restore» goes back to (WordPress _wp_trash_meta_status). */
export const CONTENT_STATUS_BEFORE_TRASH = ['draft', 'pending', 'future', 'publish', 'private'] as const
export const ContentStatusBeforeTrash = z.enum(CONTENT_STATUS_BEFORE_TRASH)
export type ContentStatusBeforeTrash = z.infer<typeof ContentStatusBeforeTrash>

/** content.comment_status: whether new comments are accepted (WordPress comment_status). */
export const COMMENT_STATUS = ['open', 'closed'] as const
export const CommentStatus = z.enum(COMMENT_STATUS)
export type CommentStatus = z.infer<typeof CommentStatus>

/** comment.status: moderation state (WordPress comment_approved 0, 1, spam, trash). */
export const COMMENT_MODERATION = ['pending', 'approved', 'spam', 'trash'] as const
export const CommentModeration = z.enum(COMMENT_MODERATION)
export type CommentModeration = z.infer<typeof CommentModeration>

/** comment.type (WordPress comment_type). Pingbacks and trackbacks are not received; they arrive only by WXR import. */
export const COMMENT_TYPE = ['comment', 'pingback', 'trackback'] as const
export const CommentType = z.enum(COMMENT_TYPE)
export type CommentType = z.infer<typeof CommentType>

/** account.status (security standard §2): read on every request, so `disabled` takes effect at once. */
export const ACCOUNT_STATUS = ['active', 'pending', 'disabled'] as const
export const AccountStatus = z.enum(ACCOUNT_STATUS)
export type AccountStatus = z.infer<typeof AccountStatus>

/** mfa_credential.type. `oidc` rows are external identities (K-025), kept with the other second factors. */
export const MFA_CREDENTIAL_TYPE = ['totp', 'passkey', 'oidc'] as const
export const MfaCredentialType = z.enum(MFA_CREDENTIAL_TYPE)
export type MfaCredentialType = z.infer<typeof MfaCredentialType>

/**
 * login_attempt.action: the rate-limited flows (K-026, K-313). `setup` counts the guesses at the one-time setup token
 * (M0.4), per address, so they cannot use up the allowance of real logins.
 */
export const LOGIN_ATTEMPT_ACTION = ['login', 'mfa', 'register', 'password_lost', 'comment', 'setup'] as const
export const LoginAttemptAction = z.enum(LOGIN_ATTEMPT_ACTION)
export type LoginAttemptAction = z.infer<typeof LoginAttemptAction>

/**
 * account_token.purpose: what a one-time link does (K-003, K-005, K-012). `set_password` is the welcome link of a new
 * account; `email_change` confirms the address in `account_token.new_email` before it replaces `account.email`.
 */
export const ACCOUNT_TOKEN_PURPOSE = ['password_reset', 'set_password', 'email_change'] as const
export const AccountTokenPurpose = z.enum(ACCOUNT_TOKEN_PURPOSE)
export type AccountTokenPurpose = z.infer<typeof AccountTokenPurpose>

/** media.visibility (K-124): private files are served only through an authorised route. */
export const MEDIA_VISIBILITY = ['public', 'private'] as const
export const MediaVisibility = z.enum(MEDIA_VISIBILITY)
export type MediaVisibility = z.infer<typeof MediaVisibility>

/** template.type: a full template or a template part (WordPress wp_template, wp_template_part). */
export const TEMPLATE_TYPE = ['template', 'template_part'] as const
export const TemplateType = z.enum(TEMPLATE_TYPE)
export type TemplateType = z.infer<typeof TemplateType>

/** content_ref.kind: a link to content or a URL, a media file in use, or an embed. */
export const CONTENT_REF_KIND = ['link', 'media', 'embed'] as const
export const ContentRefKind = z.enum(CONTENT_REF_KIND)
export type ContentRefKind = z.infer<typeof ContentRefKind>

/** redirect.status_code. 410 Gone has no target. */
export const REDIRECT_STATUS_CODE = [301, 302, 307, 308, 410] as const
export const RedirectStatusCode = z.literal(REDIRECT_STATUS_CODE)
export type RedirectStatusCode = z.infer<typeof RedirectStatusCode>

/** redirect.origin: typed in admin, made by a slug change (K-207), or imported (CSV, WXR). */
export const REDIRECT_ORIGIN = ['manual', 'slug_change', 'import'] as const
export const RedirectOrigin = z.enum(REDIRECT_ORIGIN)
export type RedirectOrigin = z.infer<typeof RedirectOrigin>

/** webhook_delivery.status. A retry is a new attempt on the same row (idempotency key = the row id). */
export const WEBHOOK_DELIVERY_STATUS = ['pending', 'succeeded', 'failed'] as const
export const WebhookDeliveryStatus = z.enum(WEBHOOK_DELIVERY_STATUS)
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>

/** release.status (K-101, phase 4: room in the model only). */
export const RELEASE_STATUS = ['open', 'scheduled', 'published', 'failed', 'cancelled'] as const
export const ReleaseStatus = z.enum(RELEASE_STATUS)
export type ReleaseStatus = z.infer<typeof ReleaseStatus>

/** extension_state.kind. */
export const EXTENSION_KIND = ['theme', 'plugin'] as const
export const ExtensionKind = z.enum(EXTENSION_KIND)
export type ExtensionKind = z.infer<typeof ExtensionKind>

/** backup.type: the daily schedule, «Back up now», or the automatic copy before a core update's migrations. */
export const BACKUP_TYPE = ['scheduled', 'manual', 'pre_update'] as const
export const BackupType = z.enum(BACKUP_TYPE)
export type BackupType = z.infer<typeof BackupType>

/** backup.target: where the copy is stored. */
export const BACKUP_TARGET = ['local', 's3', 'sftp'] as const
export const BackupTarget = z.enum(BACKUP_TARGET)
export type BackupTarget = z.infer<typeof BackupTarget>

/** backup.status. */
export const BACKUP_STATUS = ['running', 'succeeded', 'failed'] as const
export const BackupStatus = z.enum(BACKUP_STATUS)
export type BackupStatus = z.infer<typeof BackupStatus>

/** audit_log.actor_type: a person, or an automation that must not be attributed to one (product-ux workflows §20). */
export const AUDIT_ACTOR_TYPE = ['account', 'system', 'extension', 'ai'] as const
export const AuditActorType = z.enum(AUDIT_ACTOR_TYPE)
export type AuditActorType = z.infer<typeof AuditActorType>

/** audit_log.source: where the change came from. */
export const AUDIT_SOURCE = ['admin', 'api', 'cli', 'job', 'setup'] as const
export const AuditSource = z.enum(AUDIT_SOURCE)
export type AuditSource = z.infer<typeof AuditSource>

/** privacy_request.type (WordPress export_personal_data, remove_personal_data). */
export const PRIVACY_REQUEST_TYPE = ['export', 'erase'] as const
export const PrivacyRequestType = z.enum(PRIVACY_REQUEST_TYPE)
export type PrivacyRequestType = z.infer<typeof PrivacyRequestType>

/** privacy_request.status (WordPress request-pending, -confirmed, -failed, -completed). */
export const PRIVACY_REQUEST_STATUS = ['pending', 'confirmed', 'failed', 'completed'] as const
export const PrivacyRequestStatus = z.enum(PRIVACY_REQUEST_STATUS)
export type PrivacyRequestStatus = z.infer<typeof PrivacyRequestStatus>

/** consent.category: the four cookie categories of the consent API (PLAN, «Samtykke til informasjonskapsler»). */
export const CONSENT_CATEGORY = ['necessary', 'preferences', 'statistics', 'marketing'] as const
export const ConsentCategory = z.enum(CONSENT_CATEGORY)
export type ConsentCategory = z.infer<typeof ConsentCategory>

/**
 * site_secret.purpose (M0.4): the site's one-of-a-kind secrets, of which only a hash is stored. `setup_token` is the
 * one-time token that opens /setup until the site is installed (deleted by the install); `backup_recovery_key` is the
 * verifier of the recovery key the first administrator saves (PLAN «Setup-wizarden» step 6).
 */
export const SITE_SECRET_PURPOSE = ['setup_token', 'backup_recovery_key'] as const
export const SiteSecretPurpose = z.enum(SITE_SECRET_PURPOSE)
export type SiteSecretPurpose = z.infer<typeof SiteSecretPurpose>

/** admin_notice.level: WordPress' admin notice types (notice-error, -warning, -success, -info). */
export const ADMIN_NOTICE_LEVEL = ['error', 'warning', 'success', 'info'] as const
export const AdminNoticeLevel = z.enum(ADMIN_NOTICE_LEVEL)
export type AdminNoticeLevel = z.infer<typeof AdminNoticeLevel>
