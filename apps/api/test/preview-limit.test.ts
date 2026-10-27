// The embed preview limit (M1.6/M1.7): shared through Valkey by every api process, one fixed minute per account; counted in the
// process while Valkey does not answer.
import { describe, expect, it } from 'vitest'

import { TooManyRequestsError } from '../src/lib/errors.ts'
import { PREVIEWS_PER_MINUTE, createPreviewLimit, sharedPreviewLimit } from '../src/services/preview-limit.ts'
import type { CounterStore } from '../src/services/preview-limit.ts'

/** A Valkey stand-in two processes share. */
function sharedStore(): CounterStore & { expiries: Map<string, number> } {
  const counts = new Map<string, number>()
  const expiries = new Map<string, number>()
  return {
    expiries,
    incr: (key) => {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return Promise.resolve(next)
    },
    pexpire: (key, ms) => {
      expiries.set(key, ms)
      return Promise.resolve(1)
    },
  }
}

describe('the preview limit', () => {
  it('is shared by two processes through Valkey, per account and minute', async () => {
    const store = sharedStore()
    const first = sharedPreviewLimit(store, () => undefined)
    const second = sharedPreviewLimit(store, () => undefined)
    const now = 1_800_000_000_000
    for (let i = 0; i < PREVIEWS_PER_MINUTE; i += 1) await (i % 2 === 0 ? first : second).count('a', now)
    await expect(second.count('a', now)).rejects.toBeInstanceOf(TooManyRequestsError)
    await expect(first.count('b', now)).resolves.toBeUndefined()
    await expect(first.count('a', now + 60_000)).resolves.toBeUndefined()
    expect([...store.expiries.values()].every((ms) => ms === 120_000)).toBe(true)
  })

  it('counts in the process while Valkey does not answer', async () => {
    const errors: unknown[] = []
    const broken: CounterStore = {
      incr: () => Promise.reject(new Error('ECONNREFUSED')),
      pexpire: () => Promise.reject(new Error('ECONNREFUSED')),
    }
    const limit = sharedPreviewLimit(broken, (error) => errors.push(error))
    for (let i = 0; i < PREVIEWS_PER_MINUTE; i += 1) await limit.count('a', 1000)
    await expect(limit.count('a', 1000)).rejects.toBeInstanceOf(TooManyRequestsError)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('counts in memory without a Valkey address', async () => {
    const limit = createPreviewLimit('', () => undefined)
    for (let i = 0; i < PREVIEWS_PER_MINUTE; i += 1) await limit.count('a', 5000)
    await expect(limit.count('a', 5000)).rejects.toBeInstanceOf(TooManyRequestsError)
  })
})
