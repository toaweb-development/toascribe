// Rate limiting for login, second factor, registration and lost password (K-026, K-313), by IP address and by login name,
// from the `login_attempt` table (no Valkey needed). Nothing is ever locked (Tor, 2026-10-22): after a few free tries the next
// one has to wait, the wait doubles with every further failure and shrinks by itself as old failures leave the window. Nothing
// is stored about a wait: it is worked out from the attempts, so there is no state to get out of step, and the limits are the
// `login_limit_*` settings read at the moment of the check.
import { createHmac } from 'node:crypto'

import { CoreSettings } from '@toascribe/shared'
import type { LoginAttemptAction } from '@toascribe/shared'
import type { Database } from '@toascribe/db'
import type { z } from 'zod'

import { rateLimitKey } from '../lib/client-ip.ts'
import {
  insertLoginAttempt,
  listAttemptsByIp,
  listAttemptsByName,
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
  login_limit_delay_seconds: true,
  login_limit_delay_max_minutes: true,
})
export type LimitSettings = z.infer<typeof LimitSettings>

const MINUTE_MS = 60_000
const SECOND_MS = 1000

export interface DelayRule {
  /** Counted failures inside the window that are answered at once. The next attempt has to wait. */
  readonly attempts: number
  readonly windowMinutes: number
  /** The first wait. With `n` failures in the window (`n >= attempts`) the wait is `delaySeconds * 2^(n - attempts)`. */
  readonly delaySeconds: number
  readonly delayMaxMinutes: number
}

export interface Delay {
  /** The next attempt has to wait. */
  readonly delayed: boolean
  /** When the next attempt is answered; null when it is now. */
  readonly until: Date | null
  /** Failures inside the window (since the last success, for a login name). */
  readonly failures: number
}

export const NOT_DELAYED: Delay = { delayed: false, until: null, failures: 0 }

/** The wait after the last failure when `failures` are in the window. 0 while the free tries last. */
export function waitMs(failures: number, rule: DelayRule): number {
  if (failures < rule.attempts) {
    return 0
  }
  // The exponent is clamped: the cap is reached long before 2^30 and a bigger power only risks Infinity.
  const doubled = rule.delaySeconds * SECOND_MS * 2 ** Math.min(failures - rule.attempts, 30)
  return Math.min(doubled, rule.delayMaxMinutes * MINUTE_MS)
}

/**
 * Whether a subject has to wait at `now`, and until when, from its attempts in order (oldest first).
 *
 * - A failure counts for `windowMinutes`. With `n` of them in the window the next attempt is answered `waitMs(n)` after the
 *   latest failure, so more failures mean a longer wait (up to the cap).
 * - The wait shrinks by itself: the window slides, an old failure drops out, `n` falls and so does the wait. `until` is the
 *   first moment at which that is over, worked out with the failures dropping out (it is not a promise that a wait computed
 *   now stays as long: it is the earliest time the next attempt is answered).
 * - `successEnds`: a successful attempt of an account or a login name ends its streak (a right password, a finished reset, the
 *   administrator's tool). An address is many people, so a success there ends nothing, and its successes are not counted.
 * - Attempts that were turned away are not recorded by the callers, so hammering during a wait does not lengthen it.
 */
export function computeDelay(
  attempts: readonly AttemptRecord[],
  now: Date,
  rule: DelayRule,
  successEnds: boolean,
): Delay {
  const windowMs = rule.windowMinutes * MINUTE_MS
  let failures: number[] = []
  for (const attempt of attempts) {
    if (attempt.succeeded) {
      if (successEnds) {
        failures = []
      }
      continue
    }
    failures.push(attempt.at.getTime())
  }
  const nowMs = now.getTime()
  failures = failures.filter((at) => nowMs - at < windowMs)
  const last = failures.at(-1)
  if (last === undefined) {
    return NOT_DELAYED
  }
  // Segment k: the k oldest failures have dropped out of the window. It starts at `starts[k]`, and `n - k` failures count.
  const total = failures.length
  for (let dropped = 0; dropped <= total; dropped += 1) {
    const start = dropped === 0 ? nowMs : (failures[dropped - 1] ?? nowMs) + windowMs
    const end = dropped === total ? Number.POSITIVE_INFINITY : (failures[dropped] ?? nowMs) + windowMs
    const wait = waitMs(total - dropped, rule)
    const allowed = wait === 0 ? start : Math.max(start, last + wait)
    if (allowed < end) {
      return allowed > nowMs
        ? { delayed: true, until: new Date(allowed), failures: total }
        : { delayed: false, until: null, failures: total }
    }
  }
  return { delayed: false, until: null, failures: total }
}

export interface LimitSubject {
  /** The client address as `getClientIp` gives it. The limiter counts an IPv6 address by its /64 (see rateLimitKey). */
  readonly ip: string
  /** The account the request is about, when the request names one that exists. */
  readonly accountId?: string | null
  /**
   * The login name as it was typed (a username or an address), for a request that names one. Counted by its keyed hash, so a
   * name that matches no account is delayed exactly like one that does (K-004), and a name that is registered afterwards keeps
   * its history. The name itself is never kept.
   */
  readonly login?: string | null
}

export interface LimitStatus {
  readonly ip: Delay
  /** The account, or the login name when it matches none. Not delayed when the request names neither. */
  readonly account: Delay
}

/** An attempt that `begin` let through. Hand it to `succeed` when the attempt turns out right. */
export interface AttemptTicket {
  /** The delays at the moment the attempt began (before it was counted). */
  readonly status: LimitStatus
  /** The row that counts the attempt, or null when the attempt had to wait and nothing was recorded. */
  readonly attemptId: string | null
}

export interface RateLimiter {
  /** Whether the address and the account (or login name) must wait for `action` now, without counting anything. */
  check: (action: LoginAttemptAction, subject: LimitSubject) => Promise<LimitStatus>
  /**
   * Checks the limits and counts the attempt as one failure, in one step that no other request can get between: the
   * address and the account are locked (advisory locks, always in that order) while the state is read and the row is
   * written. Fifty requests sent at once therefore see one another and cannot all pass a limit of five.
   *
   * Nothing is written when the address or the account has to wait (`attemptId` is null): a refused request must not extend the
   * wait. Call `succeed` when the attempt was right; an attempt that is never settled (the process died) stays a failure.
   */
  begin: (action: LoginAttemptAction, subject: LimitSubject) => Promise<AttemptTicket>
  /** Turns a counted attempt into a success: it ends the account's streak of failures. */
  succeed: (ticket: AttemptTicket, executor?: Executor) => Promise<void>
  /**
   * Ends the streak of an account for `actions` by writing one succeeded row for each (a finished password reset; the
   * administrator's `toa user reset-login-limit` does the same from the CLI). The rows stay: the table is append-only, and an
   * address' own count is not touched because successes are not counted there.
   */
  clear: (accountId: string, ip: string, actions: readonly LoginAttemptAction[], executor?: Executor) => Promise<void>
}

/** The text a login name is hashed as: what the account lookup treats as the same name (trimmed, without regard to case). */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

/** The keyed hash of a login name that matches no account. HMAC-SHA256 under the signing key; the name cannot be read back. */
export function loginHash(signingKey: Uint8Array, login: string): string {
  return createHmac('sha256', signingKey)
    .update(`login-attempt:v1:${normalizeLogin(login)}`)
    .digest('base64url')
}

export function createRateLimiter(
  db: Database,
  clock: () => Date,
  signingKey: Uint8Array,
  onInvalidSetting?: (key: string) => void,
): RateLimiter {
  /** What the per-name counter is keyed on: the account (whatever form of its name was typed) and the hash of the name typed. */
  function nameOf(subject: LimitSubject): { readonly accountId: string | null; readonly loginHash: string | null } {
    return {
      accountId: subject.accountId ?? null,
      loginHash: subject.login === undefined || subject.login === null ? null : loginHash(signingKey, subject.login),
    }
  }

  async function statusOf(
    executor: Executor,
    action: LoginAttemptAction,
    subject: LimitSubject,
    limits: LimitSettings,
    now: Date,
  ): Promise<LimitStatus> {
    // A failure older than the window counts for nothing, so nothing older is read.
    const since = new Date(now.getTime() - limits.login_limit_window_minutes * MINUTE_MS)
    const rule = {
      windowMinutes: limits.login_limit_window_minutes,
      delaySeconds: limits.login_limit_delay_seconds,
      delayMaxMinutes: limits.login_limit_delay_max_minutes,
    }
    const byIp = await listAttemptsByIp(executor, action, rateLimitKey(subject.ip), since)
    const ip = computeDelay(byIp, now, { ...rule, attempts: limits.login_limit_ip_attempts }, false)
    const name = nameOf(subject)
    if (name.accountId === null && name.loginHash === null) {
      return { ip, account: NOT_DELAYED }
    }
    const byName = await listAttemptsByName(executor, action, name, since)
    const account = computeDelay(byName, now, { ...rule, attempts: limits.login_limit_account_attempts }, true)
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
        const name = nameOf(subject)
        if (name.loginHash !== null) {
          await lockSubject(tx, `${action}:name:${name.loginHash}`)
        }
        if (name.accountId !== null) {
          await lockSubject(tx, `${action}:account:${name.accountId}`)
        }
        const now = clock()
        const status = await statusOf(tx, action, subject, limits, now)
        if (status.ip.delayed || status.account.delayed) {
          return { status, attemptId: null }
        }
        const attemptId = await insertLoginAttempt(tx, {
          action,
          ip: rateLimitKey(subject.ip),
          accountId: name.accountId,
          loginHash: name.loginHash,
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

    async clear(accountId, ip, actions, executor = db) {
      const at = clock()
      for (const action of actions) {
        await insertLoginAttempt(executor, {
          action,
          ip: rateLimitKey(ip),
          accountId,
          loginHash: null,
          succeeded: true,
          at,
        })
      }
    },
  }
}
