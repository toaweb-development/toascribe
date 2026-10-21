// Rate limiting for login, second factor, registration and lost password (K-026, K-313), by IP address and by account,
// from the `login_attempt` table (no Valkey needed). Nothing is stored about a lockout: it is worked out from the attempts,
// so there is no state to get out of step, and the limits are the `login_limit_*` settings read at the moment of the check.
import { CoreSettings } from '@toascribe/shared'
import type { LoginAttemptAction } from '@toascribe/shared'
import type { Database } from '@toascribe/db'
import type { z } from 'zod'

import { rateLimitKey } from '../lib/client-ip.ts'
import {
  insertLoginAttempt,
  listAttemptsByAccount,
  listAttemptsByIp,
  lockSubject,
  markAttemptSucceeded,
} from '../repositories/login-attempts.ts'
import type { AttemptRecord } from '../repositories/login-attempts.ts'
import { readSettings } from '../repositories/settings.ts'
import type { Executor } from '../repositories/executor.ts'

export const LimitSettings = CoreSettings.pick({
  login_limit_account_attempts: true,
  login_limit_ip_attempts: true,
  login_limit_window_minutes: true,
  login_limit_lockout_minutes: true,
  login_limit_lockout_max_minutes: true,
})
export type LimitSettings = z.infer<typeof LimitSettings>

const MINUTE_MS = 60_000

/**
 * Which attempts count towards a lockout. A password or a code that was wrong is a failure, and a right one ends the
 * account's streak. Registering and asking for a new password have no «wrong» answer, so every request counts.
 */
const COUNTS: Readonly<Record<LoginAttemptAction, 'failures' | 'all'>> = {
  login: 'failures',
  mfa: 'failures',
  register: 'all',
  password_lost: 'all',
  comment: 'all',
}

export interface LockoutRule {
  /** Counted attempts inside the window that lock the subject. */
  readonly attempts: number
  readonly windowMinutes: number
  /** The first lockout. The n-th in a row lasts `lockoutMinutes * 2^(n-1)`, up to `lockoutMaxMinutes`. */
  readonly lockoutMinutes: number
  readonly lockoutMaxMinutes: number
}

export interface Lockout {
  readonly locked: boolean
  /** When the lockout ends; null when not locked. */
  readonly until: Date | null
  /** How many lockouts in a row the subject has earned (0 when none is recent). */
  readonly strikes: number
}

export const NOT_LOCKED: Lockout = { locked: false, until: null, strikes: 0 }

/**
 * Works out whether a subject is locked at `now`, from its attempts in order.
 *
 * Counted attempts inside a sliding `windowMinutes` window add up; reaching `attempts` starts a lockout and empties the
 * count. Attempts that fall inside a lockout are ignored (the callers do not record them). After a lockout ends, the next
 * one is twice as long, up to the cap; a subject that stays quiet for as long as the cap starts again from the base length.
 * A successful attempt ends the streak, but only when `successResets` is set (an account; not an address, which may be many people).
 */
export function computeLockout(
  attempts: readonly AttemptRecord[],
  now: Date,
  rule: LockoutRule,
  mode: 'failures' | 'all',
  successResets: boolean,
): Lockout {
  const windowMs = rule.windowMinutes * MINUTE_MS
  const decayMs = rule.lockoutMaxMinutes * MINUTE_MS
  let counted: number[] = []
  let strikes = 0
  let lockedUntil: number | null = null
  let lastLockEnd: number | null = null

  for (const attempt of attempts) {
    const at = attempt.at.getTime()
    if (lockedUntil !== null) {
      if (at < lockedUntil) {
        continue
      }
      lastLockEnd = lockedUntil
      lockedUntil = null
    }
    if (strikes > 0 && lastLockEnd !== null && at - lastLockEnd > decayMs) {
      strikes = 0
    }
    if (attempt.succeeded && successResets && mode === 'failures') {
      counted = []
      strikes = 0
      continue
    }
    if (mode === 'failures' && attempt.succeeded) {
      continue
    }
    counted = counted.filter((time) => at - time < windowMs)
    counted.push(at)
    if (counted.length >= rule.attempts) {
      strikes += 1
      const minutes = Math.min(rule.lockoutMinutes * 2 ** (strikes - 1), rule.lockoutMaxMinutes)
      lockedUntil = at + minutes * MINUTE_MS
      counted = []
    }
  }

  if (lockedUntil !== null && lockedUntil > now.getTime()) {
    return { locked: true, until: new Date(lockedUntil), strikes }
  }
  if (lockedUntil !== null) {
    lastLockEnd = lockedUntil
  }
  const decayed = strikes > 0 && lastLockEnd !== null && now.getTime() - lastLockEnd > decayMs
  return { locked: false, until: null, strikes: decayed ? 0 : strikes }
}

export interface LimitSubject {
  /** The client address as `getClientIp` gives it. The limiter counts an IPv6 address by its /64 (see rateLimitKey). */
  readonly ip: string
  /** The account the request is about, when the request names one that exists. */
  readonly accountId?: string | null
}

export interface LimitStatus {
  readonly ip: Lockout
  readonly account: Lockout
}

/** An attempt that `begin` let through. Hand it to `succeed` when the attempt turns out right. */
export interface AttemptTicket {
  /** The lockout state at the moment the attempt began (before it was counted). */
  readonly status: LimitStatus
  /** The row that counts the attempt, or null when the address was locked and nothing was recorded. */
  readonly attemptId: string | null
}

export interface RateLimiter {
  /**
   * Whether the address and the account are locked for `action` now, without counting anything. Look at `ip` and
   * `account` separately: a locked address is told so (429), but a locked account must answer like any other failure,
   * or the answer says that it exists.
   */
  check: (action: LoginAttemptAction, subject: LimitSubject) => Promise<LimitStatus>
  /**
   * Checks the limits and counts the attempt as one failure, in one step that no other request can get between: the
   * address and the account are locked (advisory locks, always in that order) while the state is read and the row is
   * written. Fifty requests sent at once therefore see one another and cannot all pass a limit of five.
   *
   * Nothing is written when the address is locked (`attemptId` is null): a refused request must not extend the lockout.
   * An attempt that was let through is counted even when the account is locked, so it adds to the address's count.
   * Call `succeed` when the attempt was right; an attempt that is never settled (the process died) stays a failure.
   */
  begin: (action: LoginAttemptAction, subject: LimitSubject) => Promise<AttemptTicket>
  /** Turns a counted attempt into a success: it ends the account's streak of failures. */
  succeed: (ticket: AttemptTicket, executor?: Executor) => Promise<void>
}

export function createRateLimiter(
  db: Database,
  clock: () => Date,
  onInvalidSetting?: (key: string) => void,
): RateLimiter {
  async function statusOf(
    executor: Executor,
    action: LoginAttemptAction,
    subject: LimitSubject,
    limits: LimitSettings,
    now: Date,
  ): Promise<LimitStatus> {
    const mode = COUNTS[action]
    // Far enough back to see a whole run of doubling lockouts and the quiet time that ends it.
    const lookbackMs = (2 * limits.login_limit_lockout_max_minutes + limits.login_limit_window_minutes) * MINUTE_MS
    const since = new Date(now.getTime() - lookbackMs)
    const rule = {
      windowMinutes: limits.login_limit_window_minutes,
      lockoutMinutes: limits.login_limit_lockout_minutes,
      lockoutMaxMinutes: limits.login_limit_lockout_max_minutes,
    }
    const byIp = await listAttemptsByIp(executor, action, rateLimitKey(subject.ip), since)
    const ip = computeLockout(byIp, now, { ...rule, attempts: limits.login_limit_ip_attempts }, mode, false)
    if (subject.accountId === undefined || subject.accountId === null) {
      return { ip, account: NOT_LOCKED }
    }
    const byAccount = await listAttemptsByAccount(executor, action, subject.accountId, since)
    const account = computeLockout(
      byAccount,
      now,
      { ...rule, attempts: limits.login_limit_account_attempts },
      mode,
      true,
    )
    return { ip, account }
  }

  return {
    async check(action, subject) {
      const limits = await readSettings(db, LimitSettings, onInvalidSetting)
      return statusOf(db, action, subject, limits, clock())
    },

    async begin(action, subject) {
      const limits = await readSettings(db, LimitSettings, onInvalidSetting)
      return db.transaction(async (tx) => {
        // Same order for everyone, so two requests cannot wait for each other.
        await lockSubject(tx, `${action}:ip:${rateLimitKey(subject.ip)}`)
        if (subject.accountId !== undefined && subject.accountId !== null) {
          await lockSubject(tx, `${action}:account:${subject.accountId}`)
        }
        const now = clock()
        const status = await statusOf(tx, action, subject, limits, now)
        if (status.ip.locked) {
          return { status, attemptId: null }
        }
        const attemptId = await insertLoginAttempt(tx, {
          action,
          ip: rateLimitKey(subject.ip),
          accountId: subject.accountId ?? null,
          succeeded: false,
          at: now,
        })
        return { status, attemptId }
      })
    },

    async succeed(ticket, executor = db) {
      if (ticket.attemptId !== null) {
        await markAttemptSucceeded(executor, ticket.attemptId)
      }
    },
  }
}
