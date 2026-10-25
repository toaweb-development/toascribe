// Reads and changes of `admin_notice` for the dashboard (typescript §8). Raising and resolving a notice is the job of the code
// that owns the condition (`raiseAdminNotice` and `resolveAdminNotice` in @toascribe/db); the dashboard lists and dismisses.
import { schema } from '@toascribe/db'
import type { AdminNoticeData } from '@toascribe/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { adminNotice } = schema

export interface StoredNotice {
  readonly key: string
  readonly level: string
  readonly messageKey: string
  readonly data: AdminNoticeData
  readonly isDismissible: boolean
}

/** Notices that are showing (not dismissed) for an account holding `capabilities`, oldest first. */
export async function listShowingNotices(db: Executor, capabilities: readonly string[]): Promise<StoredNotice[]> {
  if (capabilities.length === 0) {
    return []
  }
  return db
    .select({
      key: adminNotice.key,
      level: adminNotice.level,
      messageKey: adminNotice.messageKey,
      data: adminNotice.data,
      isDismissible: adminNotice.isDismissible,
    })
    .from(adminNotice)
    .where(and(isNull(adminNotice.dismissedAt), inArray(adminNotice.capability, [...capabilities])))
    .orderBy(asc(adminNotice.createdAt), asc(adminNotice.key))
}

/**
 * Dismisses, for everyone, a showing and dismissible notice whose capability the account holds. False when there is no such
 * notice: unknown key, already dismissed, not dismissible, or one the account may not see (the caller cannot tell which).
 */
export async function dismissNoticeFor(
  db: Executor,
  key: string,
  capabilities: readonly string[],
  now: Date,
): Promise<boolean> {
  if (capabilities.length === 0) {
    return false
  }
  const rows = await db
    .update(adminNotice)
    .set({ dismissedAt: now, modifiedAt: now })
    .where(
      and(
        eq(adminNotice.key, key),
        eq(adminNotice.isDismissible, true),
        isNull(adminNotice.dismissedAt),
        inArray(adminNotice.capability, [...capabilities]),
      ),
    )
    .returning({ id: adminNotice.id })
  return rows.length > 0
}
