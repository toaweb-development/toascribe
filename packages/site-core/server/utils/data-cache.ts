// The site's cache by tag (M1.4; PLAN «Cache og invalidering»). Not the rendered page: its HTML carries the response's CSP nonce
// (AGENTS.md, «Public site: CSP and caching»), so each request renders its page itself, from cached api answers.
//
// - What is kept: the answers of /public/resolve, /public/query and /public/settings, each with the cache tags the api put on it
//   (`content:<id>`, `term:<id>`, `media:<id>`, `list:<type>`, `settings`).
// - Where: in this process's memory (one instance), or in Valkey when `NUXT_CACHE_VALKEY_URL` is set (several instances share it).
// - When it is dropped: before each answer the site asks the api which tags changed since it last asked
//   (/public/cache/changes, on the internal network); a changed tag gets a new version, and an entry made under an older version of
//   any of its tags is not used. `all` (the first look, a look too long ago, a setting, an unknown dependency) changes every entry.
//   So a change shows on the next request, and nothing waits for a time to run out.
// - What is never cached: a request with the session cookie or a post password cookie, and a preview (the routes check it), and an
//   answer when the change log could not be read.
import { randomUUID } from 'node:crypto'

import type { H3Event } from 'h3'
import Redis from 'ioredis'

import { CacheChanges, POST_PASSWORD_COOKIE_NAME, SESSION_COOKIE_NAME } from '@toascribe/shared'

/** How long an entry is kept at most, whatever happens: a safety net, not the way changes show. */
const ENTRY_TTL_SECONDS = 60 * 60
/** The most entries kept in memory; the oldest goes first. */
const MEMORY_MAX_ENTRIES = 2000
/** The tag whose version every entry carries: `all` changes it. */
const EVERYTHING = '*'

interface Entry {
  readonly value: unknown
  /** The version of each of its tags (and of `*`) when it was made. */
  readonly versions: Readonly<Record<string, string>>
}

/** Where entries and tag versions live. */
export interface Store {
  get(key: string): Promise<string | undefined>
  getMany(keys: readonly string[]): Promise<(string | undefined)[]>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  /** Adds one to a counter and gives its new value. */
  increment(key: string): Promise<number>
}

export function memoryStore(): Store {
  const items = new Map<string, { value: string; until: number }>()
  const read = (key: string): string | undefined => {
    const item = items.get(key)
    if (item === undefined) return undefined
    if (item.until < Date.now()) {
      items.delete(key)
      return undefined
    }
    return item.value
  }
  return {
    get: async (key) => read(key),
    getMany: async (keys) => keys.map(read),
    async set(key, value, ttlSeconds) {
      items.delete(key)
      items.set(key, {
        value,
        until: ttlSeconds === undefined ? Number.POSITIVE_INFINITY : Date.now() + ttlSeconds * 1000,
      })
      // Insertion order is the age: drop the oldest beyond the cap.
      while (items.size > MEMORY_MAX_ENTRIES) {
        const oldest = items.keys().next().value
        if (oldest === undefined) break
        items.delete(oldest)
      }
    },
    async increment(key) {
      const next = Number(read(key) ?? '0') + 1
      items.set(key, { value: String(next), until: Number.POSITIVE_INFINITY })
      return next
    },
  }
}

function valkeyStore(url: string): Store {
  const client = new Redis(url, { keyPrefix: 'toascribe:site:', lazyConnect: false, maxRetriesPerRequest: 1 })
  return {
    get: async (key) => (await client.get(key)) ?? undefined,
    getMany: async (keys) => (keys.length === 0 ? [] : (await client.mget(...keys)).map((value) => value ?? undefined)),
    async set(key, value, ttlSeconds) {
      if (ttlSeconds === undefined) await client.set(key, value)
      else await client.set(key, value, 'EX', ttlSeconds)
    },
    increment: (key) => client.incr(key),
  }
}

const versionKey = (tag: string) => `tag:${tag}`
/** Counts every change of a tag version, in the store, so all instances see it. */
const CHANGES_KEY = 'changes'
const entryKey = (key: string) => `entry:${key}`

/** The cache of one site process. */
export interface DataCache {
  /**
   * The api answer for `key`, from the cache when it is current, else fetched and kept under the tags it carries. `cacheable: false`
   * (a session or a post password) fetches it and keeps nothing.
   */
  read(
    key: string,
    fetch: () => Promise<unknown>,
    tagsOf: (value: unknown) => readonly string[],
    cacheable: boolean,
  ): Promise<{ value: unknown; hit: boolean }>
}

export function createDataCache(options: {
  readonly store: Store
  /** Asks the api for the tags changed since `since` (its cursor), undefined on the first look. */
  readonly changes: (since: string | undefined) => Promise<CacheChanges>
}): DataCache {
  const { store } = options
  let cursor: string | undefined
  let pending: Promise<boolean> | undefined

  /** Brings the tag versions up to date with the change log. False when it could not be read: then nothing is cached. */
  async function catchUp(): Promise<boolean> {
    try {
      const answer = await options.changes(cursor)
      const version = randomUUID()
      const tags = answer.all ? [EVERYTHING] : answer.tags
      if (tags.length > 0) await store.increment(CHANGES_KEY)
      for (const tag of tags) await store.set(versionKey(tag), version)
      cursor = answer.cursor
      return true
    } catch {
      return false
    }
  }

  /** One look at the change log for all the requests waiting at the same moment. */
  function current(): Promise<boolean> {
    pending ??= catchUp().finally(() => {
      pending = undefined
    })
    return pending
  }

  async function versionsOf(tags: readonly string[]): Promise<Record<string, string>> {
    const all = [EVERYTHING, ...tags]
    const found = await store.getMany(all.map(versionKey))
    return Object.fromEntries(all.map((tag, index) => [tag, found[index] ?? '0']))
  }

  return {
    async read(path, fetch, tagsOf, cacheable) {
      if (!cacheable || !(await current())) return { value: await fetch(), hit: false }
      const stored = await store.get(entryKey(path)).catch(() => undefined)
      if (stored !== undefined) {
        const entry = JSON.parse(stored) as Entry
        const now = await versionsOf(Object.keys(entry.versions).filter((tag) => tag !== EVERYTHING))
        if (Object.entries(entry.versions).every(([tag, version]) => now[tag] === version)) {
          return { value: entry.value, hit: true }
        }
      }
      // An answer is kept only when no tag changed while it was fetched: it may have been read before that change was made, and
      // the versions read after it would call it current.
      const changesBefore = await store.get(CHANGES_KEY)
      const value = await fetch()
      const versions = await versionsOf([...new Set(tagsOf(value))])
      if ((await store.get(CHANGES_KEY)) === changesBefore) {
        await store
          .set(entryKey(path), JSON.stringify({ value, versions } satisfies Entry), ENTRY_TTL_SECONDS)
          .catch(() => undefined)
      }
      return { value, hit: false }
    },
  }
}

/** A request whose answer may come from the cache: nobody signed in, no post password, no preview. */
export function cacheable(event: H3Event): boolean {
  const names = Object.keys(parseCookies(event))
  return !names.includes(SESSION_COOKIE_NAME) && !names.includes(POST_PASSWORD_COOKIE_NAME)
}

let shared: DataCache | undefined

/** The process's cache, made on first use from the runtime config. */
export function useDataCache(event: H3Event): DataCache {
  if (shared !== undefined) return shared
  const config = useRuntimeConfig(event)
  const url = config.cacheValkeyUrl
  shared = createDataCache({
    store: url === '' ? memoryStore() : valkeyStore(url),
    changes: async (since) =>
      CacheChanges.parse(
        await fromPublicApi(event, since === undefined ? '/cache/changes' : `/cache/changes?since=${since}`),
      ),
  })
  return shared
}

/** The cache tags an api answer carries (`cacheTags`); none for an answer without them, which is then kept under `*` only. */
export function tagsOfAnswer(value: unknown): readonly string[] {
  const tags: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'cacheTags') : undefined
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
}

/** An api answer through the process's cache, for one of the site's data routes. */
export async function cachedFromPublicApi(event: H3Event, path: string): Promise<unknown> {
  const { value, hit } = await useDataCache(event).read(
    path,
    () => fromPublicApi(event, path),
    tagsOfAnswer,
    cacheable(event),
  )
  setResponseHeader(event, 'x-toascribe-cache', hit ? 'hit' : 'miss')
  return value
}
