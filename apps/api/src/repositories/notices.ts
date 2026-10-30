// Reads of `admin_notice` for the dashboard, and an account's own dismissals (typescript §8). Raising and resolving a notice is the
// job of the code that owns the condition (`raiseAdminNotice` and `resolveAdminNotice` in @toascribe/db); the dashboard lists them,
// and «Avvis» hides one for the account that dismissed it (M2.1), in `account.preferences.dismissedNotices` as the schema says.
import { schema } from '@toascribe/db'
import type { AdminNoticeData } from '@toascribe/shared'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { account, adminNotice } = schema

export interface StoredNotice {
  readonly key: string
  readonly level: string
  readonly messageKey: string
  readonly data: AdminNoticeData
  readonly isDismissible: boolean
  /** When the notice was last raised: a dismissal older than this does not hide it. */
  readonly modifiedAt: Date
}

const columns = {
  key: adminNotice.key,
  level: adminNotice.level,
  messageKey: adminNotice.messageKey,
  data: adminNotice.data,
  isDismissible: adminNotice.isDismissible,
  modifiedAt: adminNotice.modifiedAt,
}

/**
 * Notices that are showing (not dismissed for everyone, as before M2.1) for an account holding `capabilities`, oldest first. The
 * account's own dismissals are the service's to apply.
 */
export async function listShowingNotices(db: Executor, capabilities: readonly string[]): Promise<StoredNotice[]> {
  if (capabilities.length === 0) {
    return []
  }
  return db
    .select(columns)
    .from(adminNotice)
    .where(and(isNull(adminNotice.dismissedAt), inArray(adminNotice.capability, [...capabilities])))
    .orderBy(asc(adminNotice.createdAt), asc(adminNotice.key))
}

/** The showing, dismissible notice `key` whose capability the account holds, or undefined. */
export async function findDismissibleNotice(
  db: Executor,
  key: string,
  capabilities: readonly string[],
): Promise<StoredNotice | undefined> {
  if (capabilities.length === 0) {
    return undefined
  }
  const rows = await db
    .select(columns)
    .from(adminNotice)
    .where(
      and(
        eq(adminNotice.key, key),
        eq(adminNotice.isDismissible, true),
        isNull(adminNotice.dismissedAt),
        inArray(adminNotice.capability, [...capabilities]),
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Records that the account dismissed `key` now (the database's clock, the one `modified_at` is written with), in one statement on
 * `preferences.dismissedNotices`, an object of key to time. A value that is not an object is replaced; the other preferences stay.
 */
export async function recordNoticeDismissal(db: Executor, accountId: string, key: string): Promise<void> {
  const dismissals = sql`case when jsonb_typeof(${account.preferences} -> 'dismissedNotices') = 'object'
    then ${account.preferences} -> 'dismissedNotices' else '{}'::jsonb end`
  await db
    .update(account)
    .set({
      preferences: sql`${account.preferences} || jsonb_build_object('dismissedNotices', ${dismissals} || jsonb_build_object(${key}::text, to_jsonb(now())))`,
      modifiedAt: sql`now()`,
    })
    .where(eq(account.id, accountId))
}
