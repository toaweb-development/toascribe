// Accounts, roles, sessions, second factors, one-time links (PLAN «Innlogging og kontoer», K-001 to K-026, K-310).
// Secrets are never stored: passwords, tokens and codes as *_hash, TOTP secrets encrypted (*_encrypted, K-318).
import { sql } from 'drizzle-orm'
import { ACCOUNT_STATUS, ACCOUNT_TOKEN_PURPOSE, LOGIN_ATTEMPT_ACTION, MFA_CREDENTIAL_TYPE } from '@toascribe/shared'
import type { AccountPreferences, AccountProfile, MfaCredentialData } from '@toascribe/shared'
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { createdAt, id, inet, oneOf, timestamps, timestamptz } from './columns.ts'

/** A login (WordPress wp_users + wp_usermeta). Named account because `user` is reserved in PostgreSQL. */
export const account = pgTable(
  'account',
  {
    id: id(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** URL slug for the author archive (WordPress user_nicename). */
    nicename: text('nicename').notNull(),
    /** Argon2id, or an imported WordPress hash ($P$, $wp$2y$) upgraded at the next login (K-310). Null: no password set. */
    passwordHash: text('password_hash'),
    status: text('status').notNull(),
    /** Admin language for this account; null follows the site language (WordPress «Site Default»). */
    locale: text('locale'),
    profile: jsonb('profile').$type<AccountProfile>().notNull().default({}),
    preferences: jsonb('preferences').$type<AccountPreferences>().notNull().default({}),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Case-insensitive, as WordPress compares logins and e-mail addresses. citext would need an extension (and so
    // superuser rights at install); an expression index needs nothing, and lookups use the same lower(...).
    uniqueIndex('uq_account_username').on(sql`lower(${t.username})`),
    uniqueIndex('uq_account_email').on(sql`lower(${t.email})`),
    uniqueIndex('uq_account_nicename').on(sql`lower(${t.nicename})`),
    check('ck_account_status', oneOf(t.status, ACCOUNT_STATUS)),
  ],
)

/** A role with its capabilities (WordPress wp_user_roles). The five built-in roles are seeded, more can be made (K-019). */
export const role = pgTable(
  'role',
  {
    id: id(),
    /** Stable key: administrator, editor, author, contributor, subscriber, or an admin-made slug. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Capability names as in WordPress (edit_posts, manage_options, ...). Holding one grants it. */
    capabilities: text('capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_role_slug').on(t.slug)],
)

/** Which account has which roles. */
export const accountRole = pgTable(
  'account_role',
  {
    accountId: uuid('account_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'pk_account_role', columns: [t.accountId, t.roleId] }),
    // An account's role links go with the account.
    foreignKey({ name: 'fk_account_role_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    // A role still held by someone cannot be deleted: the service moves those accounts to another role first.
    foreignKey({ name: 'fk_account_role_role_id', columns: [t.roleId], foreignColumns: [role.id] }).onDelete(
      'restrict',
    ),
    index('idx_account_role_role_id').on(t.roleId),
  ],
)

/** A login session behind the httpOnly cookie (K-001, K-002, K-013). The cookie holds the token, the row its hash. */
export const session = pgTable(
  'session',
  {
    id: id(),
    accountId: uuid('account_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    ip: inet('ip'),
    /** The device shown in «active sessions». */
    userAgent: text('user_agent'),
    /** From the settings session_lifetime_remember_days (14) or session_lifetime_days (2), per `is_remembered`. */
    expiresAt: timestamptz('expires_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    /**
     * When the second factor was passed in this session (K-023). Null: only the password has been checked. Whether the
     * session may act then depends on whether the account needs a second factor (a confirmed factor of its own, or a
     * role in the setting mfa_required_roles), which the api checks on every request; see docs/DATAMODEL.md.
     */
    mfaVerifiedAt: timestamptz('mfa_verified_at'),
    /** «Remember me» was ticked: the session gets the long lifetime, and the cookie a Max-Age. */
    isRemembered: boolean('is_remembered').notNull().default(false),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_session_token_hash').on(t.tokenHash),
    // Sessions go with their account.
    foreignKey({ name: 'fk_session_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    // «Active sessions» and «log out everywhere else» per account; also serves the cascade.
    index('idx_session_account_id_expires_at').on(t.accountId, t.expiresAt),
    // The purge job deletes expired sessions.
    index('idx_session_expires_at').on(t.expiresAt),
  ],
)

/** An application password for API access (K-016). Shown once; only the hash is kept. */
export const appPassword = pgTable(
  'app_password',
  {
    id: id(),
    accountId: uuid('account_id').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    lastUsedAt: timestamptz('last_used_at'),
    lastUsedIp: inet('last_used_ip'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // WordPress requires a unique name per user. The index also serves the lookup by account and the cascade.
    unique('uq_app_password_account_id_name').on(t.accountId, t.name),
    // Application passwords go with their account.
    foreignKey({ name: 'fk_app_password_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
  ],
)

/**
 * A second factor or an external identity: a TOTP app (K-023), a passkey (K-024) or an OIDC login (K-025).
 * TOTP keeps its secret encrypted; a passkey or an OIDC identity is named by issuer (relying party id or OIDC `iss`) and
 * external id (credential id or `sub`), which is unique across all accounts.
 */
export const mfaCredential = pgTable(
  'mfa_credential',
  {
    id: id(),
    accountId: uuid('account_id').notNull(),
    type: text('type').notNull(),
    /** The label the user gave it («iPhone», «YubiKey»). */
    name: text('name'),
    /** TOTP only: the shared secret, encrypted with the site key (K-318). */
    secretEncrypted: text('secret_encrypted'),
    issuer: text('issuer'),
    externalId: text('external_id'),
    data: jsonb('data').$type<MfaCredentialData>().notNull().default({}),
    /** Set when enrolment is finished (the first code or ceremony succeeded); null rows never count as a factor. */
    confirmedAt: timestamptz('confirmed_at'),
    lastUsedAt: timestamptz('last_used_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_mfa_credential_type', oneOf(t.type, MFA_CREDENTIAL_TYPE)),
    check(
      'ck_mfa_credential_shape',
      sql`case when ${t.type} = 'totp' then ${t.secretEncrypted} is not null and ${t.issuer} is null and ${t.externalId} is null else ${t.secretEncrypted} is null and ${t.issuer} is not null and ${t.externalId} is not null end`,
    ),
    // One identity, one account: the same passkey or OIDC subject cannot be linked twice.
    uniqueIndex('uq_mfa_credential_identity')
      .on(t.type, t.issuer, t.externalId)
      .where(sql`${t.externalId} is not null`),
    // Second factors go with their account.
    foreignKey({ name: 'fk_mfa_credential_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    index('idx_mfa_credential_account_id').on(t.accountId),
  ],
)

/** Single-use recovery codes for two-factor login (K-023). */
export const recoveryCode = pgTable(
  'recovery_code',
  {
    id: id(),
    accountId: uuid('account_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamptz('used_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Also the lookup by account and the cascade.
    unique('uq_recovery_code_account_id_code_hash').on(t.accountId, t.codeHash),
    // Recovery codes go with their account.
    foreignKey({ name: 'fk_recovery_code_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
  ],
)

/**
 * One attempt at a rate-limited flow, for limiting by IP and by account without Valkey (K-026, K-313).
 * Append-only; a purge job deletes old rows. The typed username is not stored: account_id is null when it matched none, and
 * `login_hash` holds a keyed hash (HMAC-SHA256 under the signing key) of the normalised name that was typed, so a name that
 * matches no account is delayed exactly like one that does (K-004) and a name that is registered later keeps its history,
 * without the name or a password typed in its place being kept. A row with `succeeded` set ends the streak of its account (a
 * login, a finished reset, `toa user reset-login-limit`).
 */
export const loginAttempt = pgTable(
  'login_attempt',
  {
    id: id(),
    action: text('action').notNull(),
    ip: inet('ip').notNull(),
    accountId: uuid('account_id'),
    /** Base64url of the keyed hash of the login name or address that was typed; null where no name was typed (a code, a re-authentication, a reset marker). */
    loginHash: text('login_hash'),
    succeeded: boolean('succeeded').notNull().default(false),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_login_attempt_action', oneOf(t.action, LOGIN_ATTEMPT_ACTION)),
    // Rate-limit data has no value once the account is gone.
    foreignKey({ name: 'fk_login_attempt_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    index('idx_login_attempt_ip_created_at').on(t.ip, t.createdAt),
    index('idx_login_attempt_account_id_created_at')
      .on(t.accountId, t.createdAt)
      .where(sql`${t.accountId} is not null`),
    // The delay of a login name, known or not.
    index('idx_login_attempt_login_hash_created_at')
      .on(t.loginHash, t.createdAt)
      .where(sql`${t.loginHash} is not null`),
  ],
)

/**
 * A one-time link: password reset, the set-password link of a new account, or confirming a new e-mail address (K-003,
 * K-005, K-012; Tor: hash, purpose, expiry and when it was used, in a table of its own). The link holds the token, the
 * row only its hash. A row is used once (`used_at`), expires (`expires_at`, 24 hours by default) and is deleted by the
 * purge job after that.
 */
export const accountToken = pgTable(
  'account_token',
  {
    id: id(),
    accountId: uuid('account_id').notNull(),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** email_change only: the address that replaces account.email when the link is opened. Null for every other purpose. */
    newEmail: text('new_email'),
    expiresAt: timestamptz('expires_at').notNull(),
    /** When the link was opened and acted on; a used row never works again. */
    usedAt: timestamptz('used_at'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_account_token_token_hash').on(t.tokenHash),
    check('ck_account_token_purpose', oneOf(t.purpose, ACCOUNT_TOKEN_PURPOSE)),
    // The pending address belongs to an e-mail change, and an e-mail change cannot be without one.
    check('ck_account_token_new_email', sql`(${t.purpose} = 'email_change') = (${t.newEmail} is not null)`),
    // One-time links go with their account.
    foreignKey({ name: 'fk_account_token_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    // A new link invalidates the account's earlier ones of the same purpose; also serves the cascade.
    index('idx_account_token_account_id_purpose').on(t.accountId, t.purpose),
    // The purge job deletes expired links.
    index('idx_account_token_expires_at').on(t.expiresAt),
  ],
)
