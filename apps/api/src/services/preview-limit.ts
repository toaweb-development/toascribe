// How many embed previews an account asked for in the last minute (M1.6, security §5: each new address is a request to a provider).
// With Valkey (CACHE_VALKEY_URL, the same server the site's cache uses) the count is shared by every api process: a fixed one-minute
// window per account (`INCR` with a two-minute expiry). Without it, or while Valkey does not answer, each process counts in its own
// memory (a sliding minute), which is enough for the one api instance compose starts.
import { Redis } from 'ioredis'

import { TooManyRequestsError } from '../lib/errors.ts'

export const PREVIEWS_PER_MINUTE = 60
const WINDOW_MS = 60_000

/** The part of a Valkey client the counter uses (ioredis; a test passes its own): the count and its expiry in one atomic step. */
export interface CounterStore {
  incrWithExpiry(key: string, milliseconds: number): Promise<number>
}

export interface PreviewLimit {
  /** Counts one preview for the account; throws 429 when it is over the limit. */
  count(accountId: string, now: number): Promise<void>
  /** Closes the Valkey connection, if there is one. */
  close(): Promise<void>
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
    close: () => Promise.resolve(),
  }
}

/**
 * The limit shared through `store` (a fixed minute: up to twice the limit may pass around a window's edge, enough for a cost limit);
 * `fallback` counts while the store does not answer. `onError` is told when the store stops answering, once until it answers again.
 */
export function sharedPreviewLimit(
  store: CounterStore,
  onError: (error: unknown) => void,
  close: () => Promise<void> = () => Promise.resolve(),
): PreviewLimit {
  const fallback = memoryLimit()
  let failing = false
  return {
    async count(accountId, now) {
      const window = Math.floor(now / WINDOW_MS)
      const key = `toascribe:api:embed-preview:${accountId}:${String(window)}`
      let used: number
      try {
        used = await store.incrWithExpiry(key, 2 * WINDOW_MS)
        failing = false
      } catch (error) {
        if (!failing) onError(error)
        failing = true
        return fallback.count(accountId, now)
      }
      if (used > PREVIEWS_PER_MINUTE) throw new TooManyRequestsError(((window + 1) * WINDOW_MS - now) / 1000)
    },
    close,
  }
}

/** The limit for this process: shared through Valkey when its address is set, in memory otherwise. */
export function createPreviewLimit(valkeyUrl: string | undefined, onError: (error: unknown) => void): PreviewLimit {
  if (valkeyUrl === undefined || valkeyUrl === '') return memoryLimit()
  // A command that gets no answer in half a second fails (a frozen server would otherwise hold every preview), and the count falls
  // back to memory.
  const client = new Redis(valkeyUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
  })
  client.on('error', () => {
    // Reported through onError when a count fails; the client reconnects by itself.
  })
  const store: CounterStore = {
    async incrWithExpiry(key, milliseconds) {
      // INCR and PEXPIRE in one transaction: a key never stays without an expiry (Valkey evicts only keys that have one).
      const replies = await client.multi().incr(key).pexpire(key, milliseconds).exec()
      const [incr] = replies ?? []
      const count = incr?.[0] === null ? incr[1] : undefined
      if (typeof count !== 'number') throw new Error('no count from valkey')
      return count
    },
  }
  return sharedPreviewLimit(store, onError, () => {
    client.disconnect()
    return Promise.resolve()
  })
}
