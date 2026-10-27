// One update check (M1.7, K-290): unless it is turned off (TOASCRIBE_UPDATE_CHECK=off, or the `update_check` setting), the source is
// asked, the newest release picked, and the result kept in `update_status`, a failure too (with a reason, no address). Turned off,
// nothing is asked at all.
import { schema, writeSetting } from '@toascribe/db'
import type { DbExecutor } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import type { UpdateStatus } from '@toascribe/shared'
import { eq } from 'drizzle-orm'

import { newestRelease } from './version.ts'
import type { UpdateSource } from './source.ts'

/** Whether TOASCRIBE_UPDATE_CHECK allows checks: anything but `off` (empty is on). */
export function serverAllowsUpdateCheck(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'off'
}

/** The `update_check` setting (on when it is missing or not a boolean). */
export async function updateCheckSetting<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'update_check'))
    .limit(1)
  const parsed = CoreSettings.shape.update_check.safeParse(row?.value)
  return parsed.success ? parsed.data : true
}

/** A failure as a reason for the status: the first line, addresses and paths left out, at most 200 characters. */
function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return (text.split('\n')[0] ?? '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[adresse]')
    .replace(/\/[^\s'"]+/g, '[sti]')
    .slice(0, 200)
}

/** Asks the source once and returns the status (never throws: a failure is a status with ok false). */
export async function checkForUpdate(source: UpdateSource, current: string, now: Date): Promise<UpdateStatus> {
  try {
    const latest = newestRelease(await source.tags())
    return { checkedAt: now.toISOString(), current, latest, ok: true, error: null }
  } catch (error) {
    return { checkedAt: now.toISOString(), current, latest: null, ok: false, error: reason(error) }
  }
}

export type UpdateCheckResult =
  | { readonly checked: true; readonly status: UpdateStatus }
  | { readonly checked: false; readonly by: 'server' | 'setting' }

/** The check as the worker and `toa check-update` run it: nothing asked when it is off, the status stored when it ran. */
export async function runUpdateCheck<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  options: {
    readonly source: UpdateSource
    readonly current: string
    readonly serverAllows: boolean
    readonly now: Date
  },
): Promise<UpdateCheckResult> {
  if (!options.serverAllows) return { checked: false, by: 'server' }
  if (!(await updateCheckSetting(db))) return { checked: false, by: 'setting' }
  const status = await checkForUpdate(options.source, options.current, options.now)
  await writeSetting(db, 'update_status', status)
  return { checked: true, status }
}
