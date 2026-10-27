// How many embed previews an account asked for in the last minute (M1.6, security §5: each new address is a request to a provider).
// With Valkey (CACHE_VALKEY_URL, the same server the site's cache uses) the count is shared by every api process: a fixed one-minute
// window per account (`INCR` with a two-minute expiry). Without it, or while Valkey does not answer, each process counts in its own
// memory (a sliding minute), which is enough for the one api instance compose starts.
import { Redis } from 'ioredis'

import { TooManyRequestsError } from '../lib/errors.ts'

export const PREVIEWS_PER_MINUTE = 60
const WINDOW_MS = 60_000

/** The part of a Valkey client the counter uses (ioredis; a test passes its own). */
export interface CounterStore {
  incr(key: string): Promise<number>
  pexpire(key: string, milliseconds: number): Promise<number>
}

export interface PreviewLimit {
  /** Counts one preview for the account; throws 429 when it is over the limit. */
  count(accountId: string, now: number): Promise<void>
}

function memoryLimit(): PreviewLimit {
  const previews = new Map<string, number[]>()
  return {
    count(accountId, now) {
      const recent = (previews.get(accountId) ?? []).filter((at) => at > now - WINDOW_MS)
      if (recent.length >= PREVIEWS_PER_MINUTE) {
        return Promise.reject(new TooManyRequestsError(((recent[0] ?? now) + WINDOW_MS - now) / 1000))
      }
      recent.push(now)
      previews.set(accountId, recent)
      if (previews.size > 10_000) previews.delete(previews.keys().next().value ?? '')
      return Promise.resolve()
    },
  }
}

/** The limit shared through `store`; `fallback` counts while the store does not answer, and `onError` is told once per failure. */
export function sharedPreviewLimit(store: CounterStore, onError: (error: unknown) => void): PreviewLimit {
  const fallback = memoryLimit()
  return {
    async count(accountId, now) {
      const window = Math.floor(now / WINDOW_MS)
      const key = `toascribe:api:embed-preview:${accountId}:${String(window)}`
      let used: number
      try {
        used = await store.incr(key)
        if (used === 1) await store.pexpire(key, 2 * WINDOW_MS)
      } catch (error) {
        onError(error)
        return fallback.count(accountId, now)
      }
      if (used > PREVIEWS_PER_MINUTE) throw new TooManyRequestsError(((window + 1) * WINDOW_MS - now) / 1000)
    },
  }
}

/** The limit for this process: shared through Valkey when its address is set, in memory otherwise. */
export function createPreviewLimit(valkeyUrl: string | undefined, onError: (error: unknown) => void): PreviewLimit {
  if (valkeyUrl === undefined || valkeyUrl === '') return memoryLimit()
  const client = new Redis(valkeyUrl, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false })
  client.on('error', () => {
    // Reported per failed count (onError); the client reconnects by itself.
  })
  return sharedPreviewLimit(client, onError)
}
