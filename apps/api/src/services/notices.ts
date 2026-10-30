// The notices of the dashboard (M0.5). Two kinds, merged into one list:
// - Stored rows of `admin_notice`, raised by the code that owns a condition (the install raises «e-post hoppet over») and
//   dismissed here by each account for itself (M2.1; before that a dismissal was for everyone, and those rows stay hidden). Visible
//   to the accounts that hold the row's capability. Raising a notice again shows it again, also to those who dismissed it.
// - Computed notices (EMAIL_NOT_VERIFIED_NOTICE, PROXY_NOT_TRUSTED_NOTICE), worked out from the system each time the list is read.
//   The condition is the single source: nothing has to raise or resolve them, so they cannot drift (a settings change that clears
//   `smtp_verified_at`, a restart with `TOASCRIBE_TRUSTED_PROXY` set) and they cannot be dismissed.
import type { Database } from '@toascribe/db'
import {
  ADMIN_NOTICE_LEVEL,
  AdminNoticeLevel,
  CoreSettings,
  NoticeData as NoticeDataSchema,
  EMAIL_NOT_VERIFIED_NOTICE,
  PROXY_NOT_TRUSTED_NOTICE,
  SETUP_EMAIL_SKIPPED_NOTICE,
} from '@toascribe/shared'
import type { AdminNoticeDefinition, Notice, NoticeData } from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { NotFoundError } from '../lib/errors.ts'
import { findDismissibleNotice, listShowingNotices, recordNoticeDismissal } from '../repositories/notices.ts'
import type { StoredNotice } from '../repositories/notices.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'
import type { ProxyCheck } from './proxy-check.ts'
import type { Auditor, RequestContext } from './support.ts'

export interface NoticeService {
  /** The notices the account may see, most severe first, then in the order they were raised. */
  list: (auth: SessionAuth) => Promise<Notice[]>
  /**
   * Dismisses a stored notice for this account. Throws NotFoundError for an unknown, dismissed, undismissable or invisible one (the
   * caller cannot tell which).
   */
  dismiss: (auth: SessionAuth, key: string, ctx: RequestContext) => Promise<void>
}

/** The plain values of a stored notice's data; a nested value has no use in a message and is left out. */
function plainData(data: Record<string, unknown>): NoticeData {
  const plain: NoticeData = {}
  for (const [name, value] of Object.entries(data)) {
    const parsed = NoticeDataSchema.valueType.safeParse(value)
    if (parsed.success) {
      plain[name] = parsed.data
    }
  }
  return plain
}

/** When the account dismissed each notice, from `preferences.dismissedNotices`; a value that is not a time is left out. */
function dismissalsOf(preferences: Readonly<Record<string, unknown>>): ReadonlyMap<string, number> {
  const stored = preferences['dismissedNotices']
  const times = new Map<string, number>()
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return times
  }
  for (const [key, value] of Object.entries(stored)) {
    const time = typeof value === 'string' ? Date.parse(value) : Number.NaN
    if (!Number.isNaN(time)) {
      times.set(key, time)
    }
  }
  return times
}

/** Dismissed by this account since it was last raised. */
function dismissedBy(dismissals: ReadonlyMap<string, number>, row: StoredNotice): boolean {
  const time = dismissals.get(row.key)
  return row.isDismissible && time !== undefined && time >= row.modifiedAt.getTime()
}

function computed(definition: AdminNoticeDefinition, data: Notice['data'] = {}): Notice {
  return {
    key: definition.key,
    level: definition.level,
    messageKey: definition.messageKey,
    data,
    isDismissible: definition.isDismissible,
  }
}

export function createNoticeService(options: {
  readonly db: Database
  readonly proxy: ProxyCheck
  readonly audit: Auditor
  readonly onInvalidSetting?: (key: string) => void
}): NoticeService {
  const { db, proxy, audit, onInvalidSetting } = options
  const mailSettings = CoreSettings.pick({ smtp_verified_at: true })

  return {
    async list(auth) {
      const held = auth.capabilities
      const notices: Notice[] = []

      let emailShown = false
      if (held.has(EMAIL_NOT_VERIFIED_NOTICE.capability)) {
        const { smtp_verified_at } = await readSettings(db, mailSettings, onInvalidSetting)
        if (smtp_verified_at === null) {
          notices.push(computed(EMAIL_NOT_VERIFIED_NOTICE))
          emailShown = true
        }
      }
      if (held.has(PROXY_NOT_TRUSTED_NOTICE.capability)) {
        const status = proxy.status()
        if (status.state === 'warning') {
          notices.push(computed(PROXY_NOT_TRUSTED_NOTICE, status.address === null ? {} : { address: status.address }))
        }
      }

      const dismissals = dismissalsOf(auth.account.preferences)
      for (const row of await listShowingNotices(db, [...held])) {
        if (dismissedBy(dismissals, row)) {
          continue
        }
        // The computed e-mail notice says the same and does not go away by dismissing: one of the two is enough.
        if (emailShown && row.key === SETUP_EMAIL_SKIPPED_NOTICE.key) {
          continue
        }
        const level = AdminNoticeLevel.safeParse(row.level)
        if (level.success) {
          notices.push({
            key: row.key,
            level: level.data,
            messageKey: row.messageKey,
            data: plainData(row.data),
            isDismissible: row.isDismissible,
          })
        }
      }

      // Array.prototype.sort is stable: notices of one level stay in the order they were added above.
      return notices.sort((a, b) => ADMIN_NOTICE_LEVEL.indexOf(a.level) - ADMIN_NOTICE_LEVEL.indexOf(b.level))
    },

    async dismiss(auth, key, ctx) {
      const dismissed = await inTransaction(db, async (tx) => {
        const row = await findDismissibleNotice(tx, key, [...auth.capabilities])
        const done = row !== undefined && !dismissedBy(dismissalsOf(auth.account.preferences), row)
        if (done) {
          await recordNoticeDismissal(tx, auth.account.id, key)
          // Kept in the audit log as before, though it now hides the notice for this account only.
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'notice.dismissed',
            objectType: 'admin_notice',
            objectId: key,
            newValue: { key },
          })
        }
        return done
      })
      if (!dismissed) {
        throw new NotFoundError('No such notice')
      }
    },
  }
}
