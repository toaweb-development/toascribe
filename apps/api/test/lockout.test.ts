import { describe, expect, it } from 'vitest'

import { computeLockout } from '../src/services/rate-limit.ts'
import type { LockoutRule } from '../src/services/rate-limit.ts'

const MINUTE = 60_000
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0)
const at = (minutes: number) => new Date(T0 + minutes * MINUTE)
const fail = (minutes: number) => ({ at: at(minutes), succeeded: false })
const ok = (minutes: number) => ({ at: at(minutes), succeeded: true })

/** The defaults: 5 in 15 minutes, 20 minutes, doubling to 1440. */
const RULE: LockoutRule = { attempts: 5, windowMinutes: 15, lockoutMinutes: 20, lockoutMaxMinutes: 1440 }

function failures(...minutes: number[]) {
  return minutes.map(fail)
}

describe('computeLockout', () => {
  it('is not locked with no attempts or too few', () => {
    expect(computeLockout([], at(0), RULE, 'failures', true)).toEqual({ locked: false, until: null, strikes: 0 })
    expect(computeLockout(failures(0, 1, 2, 3), at(4), RULE, 'failures', true).locked).toBe(false)
  })

  it('locks at the Nth failure inside the window, for the base time', () => {
    const state = computeLockout(failures(0, 1, 2, 3, 4), at(5), RULE, 'failures', true)
    expect(state.locked).toBe(true)
    expect(state.until).toEqual(at(24)) // 4 + 20
    expect(state.strikes).toBe(1)
  })

  it('does not count failures that are further apart than the window', () => {
    // One every 4 minutes: never 5 inside 15 minutes.
    const spread = failures(0, 4, 8, 12, 16, 20, 24, 28, 32, 36)
    expect(computeLockout(spread, at(40), RULE, 'failures', true).locked).toBe(false)
  })

  it('unlocks when the lockout is over', () => {
    const attempts = failures(0, 1, 2, 3, 4)
    expect(computeLockout(attempts, at(23), RULE, 'failures', true).locked).toBe(true)
    const later = computeLockout(attempts, at(24), RULE, 'failures', true)
    expect(later.locked).toBe(false)
    expect(later.strikes).toBe(1) // remembered: the next lockout will be longer
  })

  it('doubles the lockout each time, up to the cap', () => {
    // Five failures right after each lockout ends.
    const rule = { ...RULE, lockoutMaxMinutes: 100 }
    const lengths: number[] = []
    let start = 0
    const attempts = [] as ReturnType<typeof fail>[]
    for (let strike = 1; strike <= 6; strike += 1) {
      for (let i = 0; i < 5; i += 1) {
        attempts.push(fail(start + i))
      }
      const state = computeLockout(attempts, at(start + 5), rule, 'failures', true)
      expect(state.locked).toBe(true)
      expect(state.strikes).toBe(strike)
      const minutes = ((state.until?.getTime() ?? 0) - (T0 + (start + 4) * MINUTE)) / MINUTE
      lengths.push(minutes)
      start = (state.until?.getTime() ?? 0) / MINUTE - T0 / MINUTE
    }
    expect(lengths).toEqual([20, 40, 80, 100, 100, 100])
  })

  it('ignores attempts made during a lockout: they neither extend it nor count towards the next', () => {
    const during = [...failures(0, 1, 2, 3, 4), ...failures(10, 11, 12, 13, 14, 15, 16, 17)]
    const state = computeLockout(during, at(18), RULE, 'failures', true)
    expect(state.until).toEqual(at(24))
    expect(state.strikes).toBe(1)
  })

  it('starts again from the base length after a quiet time as long as the cap', () => {
    const first = failures(0, 1, 2, 3, 4)
    const secondStart = 24 + 1440 + 1 // the lockout ended at 24; the cap of quiet minutes has passed
    const second = [0, 1, 2, 3, 4].map((m) => fail(secondStart + m))
    const state = computeLockout([...first, ...second], at(secondStart + 5), RULE, 'failures', true)
    expect(state.strikes).toBe(1)
    expect(state.until).toEqual(at(secondStart + 4 + 20))
    // Not quiet for that long: the second lockout is the doubled one.
    const soon = [0, 1, 2, 3, 4].map((m) => fail(30 + m))
    const doubled = computeLockout([...first, ...soon], at(35), RULE, 'failures', true)
    expect(doubled.strikes).toBe(2)
    expect(doubled.until).toEqual(at(34 + 40))
  })

  it('forgets the strikes in the answer once the quiet time has passed', () => {
    const state = computeLockout(failures(0, 1, 2, 3, 4), at(24 + 1441), RULE, 'failures', true)
    expect(state).toEqual({ locked: false, until: null, strikes: 0 })
  })

  it('lets a success end the streak of an account, but not of an address', () => {
    const mixed = [...failures(0, 1, 2, 3), ok(4), ...failures(5, 6, 7, 8)]
    expect(computeLockout(mixed, at(9), RULE, 'failures', true).locked).toBe(false)
    // An address is not freed by a success: the 8 failures still add up, so 5 are enough to lock it.
    expect(computeLockout(mixed, at(9), RULE, 'failures', false).locked).toBe(true)
    // 8 failures in 9 minutes with a success in the middle: 8 locks the address, and never the account.
    const addressRule = { ...RULE, attempts: 8 }
    expect(computeLockout(mixed, at(9), addressRule, 'failures', false).locked).toBe(true)
    expect(computeLockout(mixed, at(9), addressRule, 'failures', true).locked).toBe(false)
  })

  it('a success also clears the strikes of an account', () => {
    const attempts = [...failures(0, 1, 2, 3, 4), ok(30), ...failures(31, 32, 33, 34, 35)]
    const state = computeLockout(attempts, at(36), RULE, 'failures', true)
    expect(state.strikes).toBe(1)
    expect(state.until).toEqual(at(35 + 20))
  })

  it('in "all" mode every attempt counts, successful or not', () => {
    const attempts = [ok(0), ok(1), ok(2), ok(3), ok(4)]
    expect(computeLockout(attempts, at(5), RULE, 'all', false).locked).toBe(true)
    expect(computeLockout(attempts, at(5), RULE, 'failures', false).locked).toBe(false)
  })

  it('works with a limit of 1 attempt (every attempt locks)', () => {
    const rule = { attempts: 1, windowMinutes: 5, lockoutMinutes: 1, lockoutMaxMinutes: 60 }
    const state = computeLockout(failures(0), at(0.5), rule, 'failures', true)
    expect(state.locked).toBe(true)
    expect(state.until).toEqual(at(1))
  })
})
