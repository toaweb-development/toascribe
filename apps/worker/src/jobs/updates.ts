// The daily update check (M1.7, K-290): once a day, and once at start when the last check is a day old or there is none, the
// worker asks ghcr.io for the image tags (@toascribe/updates) and keeps the result in `update_status`. With TOASCRIBE_UPDATE_CHECK=off
// there is no schedule at all; with the `update_check` setting off the job runs and asks nothing.
import type { Database } from '@toascribe/db'
import { schema } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import { defaultUpdateSource, runUpdateCheck } from '@toascribe/updates'
import type { UpdateSource } from '@toascribe/updates'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'

export const UPDATE_CHECK = 'update.check'
/** 04:41 UTC: off the hour, so a registry is not asked by every site at once. */
export const UPDATE_CHECK_CRON = '41 4 * * *'
/** One try (tomorrow's run is the retry), and a few minutes to finish. */
export const UPDATE_QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 300 } as const
const DAY_MS = 24 * 60 * 60 * 1000

export interface UpdateJobDeps {
  readonly db: Database
  readonly logger: Logger
  /** The version that runs. */
  readonly version: string
  /** TOASCRIBE_UPDATE_CHECK is not `off`. */
  readonly serverAllows: boolean
  /** Where releases are looked up; ghcr.io by default (a test passes stored answers). */
  readonly source?: UpdateSource
  readonly now?: () => Date
}

export async function runDailyUpdateCheck(deps: UpdateJobDeps): Promise<void> {
  const result = await runUpdateCheck(deps.db, {
    source: deps.source ?? defaultUpdateSource(),
    current: deps.version,
    serverAllows: deps.serverAllows,
    now: deps.now?.() ?? new Date(),
  })
  if (!result.checked) {
    deps.logger.debug({ by: result.by }, 'update check is off')
    return
  }
  const { ok, latest, error } = result.status
  if (ok) deps.logger.info({ current: deps.version, latest }, 'update check done')
  else deps.logger.warn({ reason: error }, 'update check failed')
}

/** Whether the last check is older than a day (or missing), so one should run at start. */
export async function updateCheckDue(db: Database, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'update_status'))
    .limit(1)
  const parsed = CoreSettings.shape.update_status.safeParse(row?.value)
  if (!parsed.success || parsed.data === null) return true
  return now.getTime() - Date.parse(parsed.data.checkedAt) > DAY_MS
}
