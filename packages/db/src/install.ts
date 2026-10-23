// Install state, the install lock, the site's hashed secrets and the admin notices (M0.4). The install service (the
// setup wizard's API and `toa core install`) builds on these; see docs/DATAMODEL.md «Installation».
//
// The install transaction, in this order, on one connection:
//
//   await db.transaction(async (tx) => {
//     const state = await lockInstall(tx)          // waits for any other install, then reads `installed`
//     if (state.installed) throw new AlreadyInstalledError()
//     ... create the administrator, store the recovery key verifier (setSiteSecret) ...
//     await seedDefaultContent(tx, { siteUrl, adminAccountId, locale })
//     ... admin_email and the other settings, audit_log ...
//     await markInstalled(tx)                      // installed, installed_at, and the setup token is deleted
//   })
//
// Two installs at once: the second waits in lockInstall() until the first commits or rolls back, then reads the
// committed `installed` (READ COMMITTED reads the newest committed row in every statement, and the lock is taken
// before the read). It sees true and stops, or false (the first rolled back) and goes on. Nothing is half-written,
// because everything is in the one transaction. markInstalled() also refuses a second flip, so a caller that forgot
// the check still cannot install twice.
import type {
  AdminNoticeData,
  AdminNoticeDefinition,
  CoreSettingKey,
  JsonValue,
  SiteSecretPurpose,
} from '@toascribe/shared'
import { CoreSettings } from '@toascribe/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { DbExecutor, DbTransaction } from './executor.ts'
import { setting } from './schema/site.ts'
import { adminNotice, siteSecret } from './schema/system.ts'

/**
 * The transaction-level advisory lock that serialises installs: 0x746f6169, "toai" in ASCII (the migration runner's
 * session lock is "toas"). Advisory locks are per database, so it only serialises installs of the same site.
 */
export const INSTALL_LOCK_KEY = 1_953_456_489

export interface InstallState {
  readonly installed: boolean
  /** ISO 8601 UTC, or null before the install. */
  readonly installedAt: string | null
}

/** The site is installed already: the install must stop and change nothing (the api answers 409, the CLI exit 1). */
export class AlreadyInstalledError extends Error {
  override readonly name = 'AlreadyInstalledError'
  constructor() {
    super('the site is already installed')
  }
}

async function readInstallState<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<InstallState> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, ['installed', 'installed_at']))
  const value = (key: CoreSettingKey): JsonValue | undefined => rows.find((r) => r.key === key)?.value
  const at = value('installed_at')
  // Anything but JSON true (no row, null, a string) is «not installed»: the safe reading is the one that keeps /setup
  // closed only when the install really committed.
  return { installed: value('installed') === true, installedAt: typeof at === 'string' ? at : null }
}

/** Reads `installed` and `installed_at` without a lock, e.g. for GET /setup/status and the middleware. */
export function getInstallState<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<InstallState> {
  return readInstallState(db)
}

/**
 * Takes the install lock for the rest of the transaction (pg_advisory_xact_lock: released at commit or rollback,
 * never by hand), then reads the install state. Must be the first thing the install transaction does. It waits for
 * as long as another install holds the lock; the caller's statement_timeout, if any, bounds the wait.
 */
export async function lockInstall<TSchema extends Record<string, unknown>>(
  tx: DbTransaction<TSchema>,
): Promise<InstallState> {
  await tx.execute(sql`select pg_advisory_xact_lock(${INSTALL_LOCK_KEY}::bigint)`)
  return readInstallState(tx)
}

/**
 * Inserts or replaces one core setting's value after validating it with its CoreSettings schema (a ZodError otherwise).
 * JSON goes through text, so null stays JSON null. It does not check READ_ONLY_SETTING_KEYS: that is the settings
 * API's job; markInstalled() writes `installed_at` through it.
 */
export async function writeSetting<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  key: CoreSettingKey,
  value: JsonValue,
): Promise<void> {
  const valid: unknown = CoreSettings.shape[key].parse(value)
  await db
    .insert(setting)
    .values({ key, value: sql`${JSON.stringify(valid)}::jsonb` })
    .onConflictDoUpdate({ target: setting.key, set: { value: sql`excluded.value`, modifiedAt: sql`now()` } })
}

/**
 * Sets `installed` to true and `installed_at` to `at`, and deletes the setup token, in the caller's install
 * transaction (call lockInstall() first). Throws AlreadyInstalledError when `installed` is already true, so a second
 * install can never commit. Returns `installed_at` as stored.
 */
export async function markInstalled<TSchema extends Record<string, unknown>>(
  tx: DbTransaction<TSchema>,
  at: Date = new Date(),
): Promise<string> {
  const flipped = await tx
    .insert(setting)
    .values({ key: 'installed', value: sql`'true'::jsonb` })
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: sql`'true'::jsonb`, modifiedAt: sql`now()` },
      setWhere: sql`${setting.value} is distinct from 'true'::jsonb`,
    })
    .returning({ key: setting.key })
  if (flipped.length === 0) {
    throw new AlreadyInstalledError()
  }
  const installedAt = at.toISOString()
  await writeSetting(tx, 'installed_at', installedAt)
  await deleteSiteSecret(tx, 'setup_token')
  return installedAt
}

/**
 * Stores the hash of a site secret, replacing the earlier one of the same purpose; `created_at` is reset, so it is
 * when this secret was made. The hash must be 64 lower-case hex characters (the CHECK refuses anything else, a raw
 * token included). Scheme: docs/DATAMODEL.md «Installation».
 */
export async function setSiteSecret<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  purpose: SiteSecretPurpose,
  secretHash: string,
): Promise<void> {
  await db
    .insert(siteSecret)
    .values({ purpose, secretHash })
    .onConflictDoUpdate({
      target: siteSecret.purpose,
      set: { secretHash: sql`excluded.secret_hash`, createdAt: sql`now()`, modifiedAt: sql`now()` },
    })
}

export interface SiteSecretRow {
  readonly secretHash: string
  readonly createdAt: Date
}

/** The stored hash of a site secret and when it was made, or undefined when there is none. */
export async function getSiteSecret<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  purpose: SiteSecretPurpose,
): Promise<SiteSecretRow | undefined> {
  const rows = await db
    .select({ secretHash: siteSecret.secretHash, createdAt: siteSecret.createdAt })
    .from(siteSecret)
    .where(eq(siteSecret.purpose, purpose))
  return rows[0]
}

/** Deletes a site secret; true when there was one. */
export async function deleteSiteSecret<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  purpose: SiteSecretPurpose,
): Promise<boolean> {
  const rows = await db.delete(siteSecret).where(eq(siteSecret.purpose, purpose)).returning({ id: siteSecret.id })
  return rows.length > 0
}

/**
 * Raises an admin notice: inserts it, or, when its key is there already, replaces its level, text key, capability,
 * dismissibility and data and shows it again (clears `dismissed_at`).
 */
export async function raiseAdminNotice<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  notice: AdminNoticeDefinition,
  data: AdminNoticeData = {},
): Promise<void> {
  const values = {
    key: notice.key,
    level: notice.level,
    messageKey: notice.messageKey,
    capability: notice.capability,
    isDismissible: notice.isDismissible,
    data: sql`${JSON.stringify(data)}::jsonb`,
  }
  await db
    .insert(adminNotice)
    .values(values)
    .onConflictDoUpdate({
      target: adminNotice.key,
      set: {
        level: sql`excluded.level`,
        messageKey: sql`excluded.message_key`,
        capability: sql`excluded.capability`,
        isDismissible: sql`excluded.is_dismissible`,
        data: sql`excluded.data`,
        dismissedAt: null,
        modifiedAt: sql`now()`,
      },
    })
}

/** Resolves an admin notice (the condition is gone): deletes its row. True when there was one. */
export async function resolveAdminNotice<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  key: string,
): Promise<boolean> {
  const rows = await db.delete(adminNotice).where(eq(adminNotice.key, key)).returning({ id: adminNotice.id })
  return rows.length > 0
}

/** Dismisses a dismissible notice for everyone; true when a showing notice was dismissed. */
export async function dismissAdminNotice<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  key: string,
): Promise<boolean> {
  const rows = await db
    .update(adminNotice)
    .set({ dismissedAt: sql`now()`, modifiedAt: sql`now()` })
    .where(and(eq(adminNotice.key, key), eq(adminNotice.isDismissible, true), sql`${adminNotice.dismissedAt} is null`))
    .returning({ id: adminNotice.id })
  return rows.length > 0
}
