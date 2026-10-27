// Maintenance mode (M1.7, K-288): one setting, `maintenance_mode`, written here by everything that turns it on or off (`toa
// maintenance`, a restore, a migration) with a cache change for every tag (`*`), so the site sees it on its next request.
import { CoreSettings } from '@toascribe/shared'
import type { MaintenanceMode } from '@toascribe/shared'
import { eq } from 'drizzle-orm'

import type { DbExecutor } from './executor.ts'
import { writeSetting } from './install.ts'
import { setting } from './schema/site.ts'
import { cacheInvalidation } from './schema/system.ts'

/** The default (off) when the setting is not stored, or does not pass. */
const OFF: MaintenanceMode = CoreSettings.shape.maintenance_mode.parse({
  enabled: false,
  message: '',
  retryAfter: 600,
  since: null,
})

export async function readMaintenanceMode<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<MaintenanceMode> {
  const [row] = await db
    .select({ value: setting.value })
    .from(setting)
    .where(eq(setting.key, 'maintenance_mode'))
    .limit(1)
  const parsed = CoreSettings.shape.maintenance_mode.safeParse(row?.value)
  return parsed.success ? parsed.data : OFF
}

/** Turns maintenance mode on (with a message and a wait) or off, and tells the site's cache. */
export async function setMaintenanceMode<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  next: { readonly enabled: boolean; readonly message?: string; readonly retryAfter?: number },
  now: Date,
): Promise<MaintenanceMode> {
  const before = await readMaintenanceMode(db)
  const value: MaintenanceMode = next.enabled
    ? {
        enabled: true,
        message: next.message ?? before.message,
        retryAfter: next.retryAfter ?? before.retryAfter,
        since: before.enabled && before.since !== null ? before.since : now.toISOString(),
      }
    : { ...before, enabled: false, since: null }
  await writeSetting(db, 'maintenance_mode', value)
  await db.insert(cacheInvalidation).values({ tag: '*', changedAt: now })
  return value
}
