// Reads of the `setting` table (typescript §8). A key is validated against the schema it is read with and falls back to the
// default when the row is missing or holds something the schema refuses, so a bad value can never loosen a limit or break a mail.
import { schema } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { CORE_SETTINGS } from '@toascribe/shared'
import { eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'

const { setting } = schema

const DEFAULTS: ReadonlyMap<string, unknown> = new Map(Object.entries(CORE_SETTINGS))

/**
 * The settings named by `picked` (a `CoreSettings.pick({...})`), each as stored when valid and as the default otherwise.
 * `onInvalid` hears about every stored value that was refused, so it can be logged.
 */
export async function readSettings<S extends z.ZodObject<Record<string, z.ZodType>>>(
  db: Database,
  picked: S,
  onInvalid?: (key: string) => void,
): Promise<z.infer<S>> {
  const keys = Object.keys(picked.shape)
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, keys))
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const field = picked.shape[key]
    const parsed = stored.has(key) && field !== undefined ? field.safeParse(stored.get(key)) : undefined
    if (parsed?.success === true) {
      merged[key] = parsed.data
    } else {
      if (parsed !== undefined) {
        onInvalid?.(key)
      }
      merged[key] = DEFAULTS.get(key)
    }
  }
  return picked.parse(merged)
}

/** The bounds of a retention setting, as the database function `audit_log_clear_old_ips()` applies them. */
export interface RetentionRule {
  readonly key: 'ip_retention_days' | 'spam_comment_retention_days'
  readonly min: number
  readonly max: number
  /** Used when the row is missing or does not hold a whole number. */
  readonly fallback: number
}

export const IP_RETENTION: RetentionRule = { key: 'ip_retention_days', min: 7, max: 3650, fallback: 90 }
export const SPAM_RETENTION: RetentionRule = { key: 'spam_comment_retention_days', min: 1, max: 365, fallback: 30 }

/**
 * How many days to keep what the setting governs. A whole number is clamped into the rule's bounds (a value below the floor
 * counts as the floor, so a bad row can only keep data longer, never delete it sooner), anything else is the fallback.
 * This is the same reading as the SQL function that clears the audit log's IP addresses, so the tables agree.
 */
export async function readRetentionDays(db: Database, rule: RetentionRule): Promise<number> {
  const rows = await db.select({ value: setting.value }).from(setting).where(eq(setting.key, rule.key))
  const value = rows[0]?.value
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return rule.fallback
  }
  return Math.min(rule.max, Math.max(rule.min, value))
}
