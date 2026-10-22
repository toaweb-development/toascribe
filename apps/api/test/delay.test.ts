// computeDelay: the increasing delay that replaces the hard lock (Tor, 2026-10-22). Pure: no database, fake time.
import { describe, expect, it } from 'vitest'

import { NOT_DELAYED, computeDelay, loginHash, normalizeLogin, waitMs } from '../src/services/rate-limit.ts'
import type { DelayRule } from '../src/services/rate-limit.ts'
import type { AttemptRecord } from '../src/repositories/login-attempts.ts'

const SECOND = 1000
const MINUTE = 60 * SECOND
const T0 = new Date('2027-01-10T12:00:00Z').getTime()
const at = (ms: number) => new Date(T0 + ms)

/** 5 free tries, then 30 s doubling up to 15 minutes, remembered for an hour (the defaults). */
const RULE: DelayRule = { attempts: 5, windowMinutes: 60, delaySeconds: 30, delayMaxMinutes: 15 }

const failure = (ms: number): AttemptRecord => ({ at: at(ms), succeeded: false })
const success = (ms: number): AttemptRecord => ({ at: at(ms), succeeded: true })
const failuresAt = (...ms: number[]) => ms.map(failure)

describe('waitMs', () => {
  it('is nothing while the free tries last, then 30 s, 1, 2, 4, 8 minutes, and never more than the cap', () => {
    const seconds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 40].map((n) => waitMs(n, RULE) / SECOND)
    expect(seconds).toEqual([0, 0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 900])
  })

  it('follows the rule: a base of 10 s from the 2nd failure, a cap of 10 minutes', () => {
    const rule = { attempts: 2, windowMinutes: 30, delaySeconds: 10, delayMaxMinutes: 10 }
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => waitMs(n, rule) / SECOND)).toEqual([0, 10, 20, 40, 80, 160, 320])
    expect(waitMs(9, rule) / SECOND).toBe(600)
  })

  it('does not overflow for an absurd number of failures', () => {
    expect(waitMs(10_000, RULE)).toBe(15 * MINUTE)
  })
})

describe('computeDelay', () => {
  it('is not delayed with no attempts, or with fewer than the free tries', () => {
    expect(computeDelay([], at(0), RULE, true)).toEqual(NOT_DELAYED)
    expect(
      computeDelay(
        failuresAt(0, 1, 2, 3).map((a) => a),
        at(4),
        RULE,
        true,
      ),
    ).toEqual({
      delayed: false,
      until: null,
      failures: 4,
    })
  })

  it('makes the next attempt wait 30 s after the fifth failure, counted from that failure', () => {
    const delay = computeDelay(failuresAt(0, 1, 2, 3, 4 * SECOND), at(5 * SECOND), RULE, true)
    expect(delay.delayed).toBe(true)
    expect(delay.until).toEqual(at(4 * SECOND + 30 * SECOND))
    expect(delay.failures).toBe(5)
    // Over when the 30 seconds are.
    expect(computeDelay(failuresAt(0, 1, 2, 3, 4 * SECOND), at(34 * SECOND), RULE, true).delayed).toBe(false)
    expect(computeDelay(failuresAt(0, 1, 2, 3, 4 * SECOND), at(34 * SECOND - 1), RULE, true).delayed).toBe(true)
  })

  it('grows with every failure, by doubling, up to the cap: the wait after the 1st, 2nd ... 12th failure', () => {
    const waits: number[] = []
    let last = 0
    const seen: AttemptRecord[] = []
    for (let n = 1; n <= 12; n += 1) {
      // Each failure comes the moment the previous wait is over.
      seen.push(failure(last))
      const delay = computeDelay(seen, at(last), RULE, true)
      const wait = (delay.until?.getTime() ?? last + T0) - T0 - last
      waits.push(wait / SECOND)
      last = last + wait
    }
    // The twelfth failure comes 45.5 minutes in; the first five (all at the start) leave the window at 60 minutes, which is
    // before the full 15 minutes are up, so the wait is 14.5 minutes: it shrinks by itself.
    expect(waits).toEqual([0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 870])
  })

  it('shrinks by itself as old failures leave the window: the same ten failures wait less and less', () => {
    // Ten failures in the first minute: the wait after the last is the cap, 15 minutes.
    const burst = Array.from({ length: 10 }, (_, i) => failure(i * 6 * SECOND))
    const lastAt = 9 * 6 * SECOND
    expect(computeDelay(burst, at(lastAt), RULE, true).until).toEqual(at(lastAt + 15 * MINUTE))
    // At 61 minutes the first failure has left the window: nine count, the wait is 8 minutes from the last failure, long past.
    const later = computeDelay(burst, at(61 * MINUTE), RULE, true)
    expect(later.failures).toBeLessThan(10)
    expect(later.delayed).toBe(false)
    // After an hour of quiet nothing is remembered.
    expect(computeDelay(burst, at(lastAt + 61 * MINUTE), RULE, true)).toEqual(NOT_DELAYED)
  })

  it('reports the earliest moment the next attempt is answered, counting the failures that drop out in the meantime', () => {
    // Failures at 0, 1, 2, 3 and 59 minutes. At 59 min there are 5 in the window: the wait is 30 s after the last, until 59:30.
    // The first one drops out at 60 min, but 59:30 comes first.
    const mixed = failuresAt(0, 1 * MINUTE, 2 * MINUTE, 3 * MINUTE, 59 * MINUTE)
    expect(computeDelay(mixed, at(59 * MINUTE + 1), RULE, true).until).toEqual(at(59 * MINUTE + 30 * SECOND))
    // With the cap longer than what is left of the window, the drop-out comes first: 5 failures, last at 58 min, rule with a 15
    // minute base: allowed at 58+15 = 73 min, but the first drops out at 60 min, leaving 4, which are free.
    const slow = { attempts: 5, windowMinutes: 60, delaySeconds: 600, delayMaxMinutes: 15 }
    const dropping = failuresAt(0, 1 * MINUTE, 2 * MINUTE, 3 * MINUTE, 58 * MINUTE)
    expect(computeDelay(dropping, at(58 * MINUTE + 1), slow, true).until).toEqual(at(60 * MINUTE))
  })

  it('does not count failures that are further apart than the window', () => {
    const spread = Array.from({ length: 12 }, (_, i) => failure(i * 13 * MINUTE))
    expect(computeDelay(spread, at(11 * 13 * MINUTE + MINUTE), RULE, true).delayed).toBe(false)
  })

  it('lets a success end the streak of an account or a login name, but not of an address', () => {
    const mixed: AttemptRecord[] = [...failuresAt(0, 1, 2, 3), success(4), ...failuresAt(5, 6, 7, 8)]
    expect(computeDelay(mixed, at(9), RULE, true).delayed).toBe(false)
    // For an address the success is not counted and ends nothing: eight failures.
    const address = { ...RULE, attempts: 8 }
    expect(computeDelay(mixed, at(9), address, false).delayed).toBe(true)
    expect(computeDelay(mixed, at(9), address, true).delayed).toBe(false)
  })

  it('a marker row written by a reset or the administrator ends the streak at once', () => {
    const burst: AttemptRecord[] = [...failuresAt(0, 1, 2, 3, 4, 5, 6, 7), success(8 * SECOND)]
    expect(computeDelay(burst.slice(0, -1), at(9 * SECOND), RULE, true).delayed).toBe(true)
    expect(computeDelay(burst, at(9 * SECOND), RULE, true)).toEqual(NOT_DELAYED)
    // And what comes after it counts from nothing.
    expect(computeDelay([...burst, ...failuresAt(10 * SECOND)], at(11 * SECOND), RULE, true).failures).toBe(1)
  })

  it('works with a limit of 1: the second try waits', () => {
    const rule = { attempts: 1, windowMinutes: 5, delaySeconds: 1, delayMaxMinutes: 10 }
    const delay = computeDelay(failuresAt(0), at(100), rule, true)
    expect(delay.delayed).toBe(true)
    expect(delay.until).toEqual(at(1000))
  })

  it('is answered by the end of the window at the latest', () => {
    // A wait that would last 15 minutes in a window of 5 minutes ends with the window.
    const rule = { attempts: 1, windowMinutes: 5, delaySeconds: 600, delayMaxMinutes: 15 }
    const delay = computeDelay(failuresAt(0), at(1000), rule, true)
    expect(delay.until).toEqual(at(5 * MINUTE))
  })
})

describe('loginHash', () => {
  const key = new Uint8Array(32).fill(7)

  it('is the same for one name however it is written, and for nothing else', () => {
    expect(normalizeLogin('  Kari@Example.NO ')).toBe('kari@example.no')
    expect(loginHash(key, 'Kari')).toBe(loginHash(key, ' kari '))
    expect(loginHash(key, 'kari')).not.toBe(loginHash(key, 'kari2'))
  })

  it('is keyed: another key gives another hash, and the name cannot be read in it', () => {
    const other = new Uint8Array(32).fill(8)
    expect(loginHash(key, 'kari')).not.toBe(loginHash(other, 'kari'))
    expect(loginHash(key, 'kari')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(loginHash(key, 'kari')).not.toContain('kari')
  })
})
