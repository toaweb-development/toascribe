// Installation state and records: extensions, backups, the audit log, privacy requests and consent; since M0.4 the site's
// hashed secrets (setup token, recovery key) and the admin notices.
import { sql } from 'drizzle-orm'
import {
  ADMIN_NOTICE_LEVEL,
  AUDIT_ACTOR_TYPE,
  AUDIT_SOURCE,
  BACKUP_STATUS,
  BACKUP_TARGET,
  BACKUP_TYPE,
  CONSENT_CATEGORY,
  EXTENSION_KIND,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPE,
  SITE_SECRET_PURPOSE,
} from '@toascribe/shared'
import type { AdminNoticeData, ExtensionSettings, JsonValue } from '@toascribe/shared'
import { bigint, boolean, check, foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { account } from './accounts.ts'
import { createdAt, id, inet, oneOf, timestamps, timestamptz, xid8 } from './columns.ts'

/** An installed theme or plugin (K-145 to K-174; WordPress active_plugins and theme_mods). */
export const extensionState = pgTable(
  'extension_state',
  {
    id: id(),
    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    version: text('version').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    settings: jsonb('settings').$type<ExtensionSettings>().notNull().default({}),
    /** The permissions the administrator approved; a new version asking for more needs approval again (K-174). */
    approvedPermissions: text('approved_permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    autoUpdate: boolean('auto_update').notNull().default(false),
    /** Why it was deactivated automatically (K-167); null when it runs. */
    lastError: text('last_error'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_extension_state_kind_slug').on(t.kind, t.slug),
    check('ck_extension_state_kind', oneOf(t.kind, EXTENSION_KIND)),
  ],
)

/** One backup run (K-292, K-293): what, when, how big, where, and whether a restore test passed. */
export const backup = pgTable(
  'backup',
  {
    id: id(),
    type: text('type').notNull(),
    target: text('target').notNull(),
    status: text('status').notNull().default('running'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    /** Bytes. */
    size: bigint('size', { mode: 'number' }),
    /** Where the archive is at the target (path or object key). */
    location: text('location'),
    /** When the weekly restore test last passed for this copy; null if never. */
    verifiedAt: timestamptz('verified_at'),
    error: text('error'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_backup_type', oneOf(t.type, BACKUP_TYPE)),
    check('ck_backup_target', oneOf(t.target, BACKUP_TARGET)),
    check('ck_backup_status', oneOf(t.status, BACKUP_STATUS)),
  ],
)

/**
 * Who did what (K-315; security standard §8; product-ux workflows §20). Append-only: the app role has INSERT and SELECT
 * only. The IP is cleared after 90 days by `audit_log_clear_old_ips()`, a SECURITY DEFINER function owned by the owner
 * role that the app role may only execute (both in migration 0001_audit_log_privileges). Changes made by an automation
 * carry its actor_type and name and are never attributed to a person.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    /**
     * The person, when actor_type is account (or the person who approved an automated change). Set to null when the
     * account is deleted; `actor` keeps the name.
     */
    accountId: uuid('account_id'),
    actorType: text('actor_type').notNull(),
    /**
     * Who acted, written on every row and never changed: the account's username at the time when actor_type is account,
     * otherwise the job, extension slug, or AI model or tool. It outlives the account.
     */
    actor: text('actor').notNull(),
    /** What happened, e.g. setting.updated, role.capabilities_changed, login.succeeded. */
    action: text('action').notNull(),
    objectType: text('object_type'),
    objectId: text('object_id'),
    oldValue: jsonb('old_value').$type<JsonValue>(),
    newValue: jsonb('new_value').$type<JsonValue>(),
    reason: text('reason'),
    source: text('source').notNull(),
    /** The request id (X-Request-Id) or job id, to find the log lines. */
    correlationId: text('correlation_id'),
    /** Kept for 90 days (PLAN), then set to null by audit_log_clear_old_ips(). */
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_audit_log_actor_type', oneOf(t.actorType, AUDIT_ACTOR_TYPE)),
    check('ck_audit_log_actor', sql`btrim(${t.actor}) <> ''`),
    check('ck_audit_log_source', oneOf(t.source, AUDIT_SOURCE)),
    // The entry stays when the account is deleted; it loses the link, not the record or the actor's name.
    foreignKey({ name: 'fk_audit_log_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    // The log is read newest first, and the IP job works by age.
    index('idx_audit_log_created_at').on(t.createdAt),
    index('idx_audit_log_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/** A request to export or erase personal data, confirmed by e-mail (K-205; WordPress user_request). */
export const privacyRequest = pgTable(
  'privacy_request',
  {
    id: id(),
    type: text('type').notNull(),
    email: text('email').notNull(),
    /** The account with that e-mail, if any. */
    accountId: uuid('account_id'),
    status: text('status').notNull().default('pending'),
    /** Hash of the token in the confirmation link. */
    tokenHash: text('token_hash'),
    confirmedAt: timestamptz('confirmed_at'),
    completedAt: timestamptz('completed_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_privacy_request_token_hash').on(t.tokenHash),
    check('ck_privacy_request_type', oneOf(t.type, PRIVACY_REQUEST_TYPE)),
    check('ck_privacy_request_status', oneOf(t.status, PRIVACY_REQUEST_STATUS)),
    // The request (and the proof that it was handled) stays when the account is erased.
    foreignKey({
      name: 'fk_privacy_request_account_id',
      columns: [t.accountId],
      foreignColumns: [account.id],
    }).onDelete('set null'),
    index('idx_privacy_request_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/**
 * One consent decision for one cookie category (K-209, K-234). Append-only: the newest row per subject and category
 * is the current choice, and the rows are the record of when it was given or withdrawn.
 */
export const consent = pgTable(
  'consent',
  {
    id: id(),
    /** Random id from the visitor's consent cookie; not derived from IP or account. */
    subjectKey: text('subject_key').notNull(),
    accountId: uuid('account_id'),
    category: text('category').notNull(),
    granted: boolean('granted').notNull(),
    /** Version of the privacy text the visitor saw. */
    policyVersion: text('policy_version').notNull().default(''),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_consent_category', oneOf(t.category, CONSENT_CATEGORY)),
    // The record stays, without the link, when the account is deleted.
    foreignKey({ name: 'fk_consent_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    index('idx_consent_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/**
 * The site's one-of-a-kind secrets, as hashes only (M0.4): the one-time setup token and the verifier of the backup
 * recovery key. A table of its own rather than `setting` rows, so that no settings reader, settings API, `toa option`
 * or settings export can return one by accident. One row per purpose; the hash is 64 lower-case hex characters (a
 * SHA-256 or HMAC-SHA256), which also stops a raw token from being stored by mistake. See docs/DATAMODEL.md.
 */
export const siteSecret = pgTable(
  'site_secret',
  {
    id: id(),
    purpose: text('purpose').notNull(),
    secretHash: text('secret_hash').notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_site_secret_purpose').on(t.purpose),
    check('ck_site_secret_purpose', oneOf(t.purpose, SITE_SECRET_PURPOSE)),
    check('ck_site_secret_secret_hash', sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * A site-wide notice for the admin dashboard (M0.4 stores the first, M0.5 shows them): one row per key, with the i18n
 * key of its text and the values the text interpolates. Raising a notice again updates the row and clears the
 * dismissal; resolving it deletes the row. Per-account dismissal, if it comes, belongs in account.preferences.
 */
export const adminNotice = pgTable(
  'admin_notice',
  {
    id: id(),
    key: text('key').notNull(),
    level: text('level').notNull(),
    /** The admin's i18n key, e.g. notices.setupEmailSkipped. Never screen text. */
    messageKey: text('message_key').notNull(),
    data: jsonb('data').$type<AdminNoticeData>().notNull().default({}),
    /** Who sees it: accounts holding this capability. */
    capability: text('capability').notNull().default('manage_options'),
    isDismissible: boolean('is_dismissible').notNull().default(true),
    /** Dismissed for everyone; null while it shows. */
    dismissedAt: timestamptz('dismissed_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_admin_notice_key').on(t.key),
    check('ck_admin_notice_level', oneOf(t.level, ADMIN_NOTICE_LEVEL)),
    check('ck_admin_notice_key', sql`${t.key} ~ '^[a-z0-9_.-]+$'`),
    check('ck_admin_notice_message_key', sql`${t.messageKey} <> ''`),
  ],
)

/**
 * Cache invalidation (M1.4, PLAN «Cache og invalidering»): an append-only log of the cache tags a change touched (`content:<id>`,
 * `list:<type>`, `term:<id>`, `media:<id>`, `*` for everything). The site asks for the tags changed since its last look and drops the
 * cached data that carries them. The worker removes rows older than a day; a site that has not looked for that long drops everything.
 *
 * The site's place in the log is a transaction id, not a time: `xid` is the id of the transaction that wrote the row, and the api
 * hands the site the oldest transaction still running (`pg_snapshot_xmin`) as its next place. A change that commits after the site
 * looked therefore comes in the next look, however long its transaction ran; a time would miss it.
 */
export const cacheInvalidation = pgTable(
  'cache_invalidation',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tag: text('tag').notNull(),
    changedAt: timestamptz('changed_at')
      .notNull()
      .default(sql`now()`),
    xid: xid8('xid')
      .notNull()
      .default(sql`pg_current_xact_id()`),
  },
  (t): PgTableExtraConfigValue[] => [
    index('idx_cache_invalidation_changed_at').on(t.changedAt),
    index('idx_cache_invalidation_xid').on(t.xid),
    check('ck_cache_invalidation_tag', sql`${t.tag} ~ '^(\\*|[a-z_]+(:[A-Za-z0-9_-]+)?)$'`),
  ],
)
