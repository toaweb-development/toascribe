// The site's data cache by tag (M1.4): an answer is kept under its tags, a changed tag or `all` makes it stale at once, nothing is
// kept for a signed-in person or a post password, nothing when the change log cannot be read, and nothing that was fetched while a
// tag changed.
import type { CacheChanges } from '@toascribe/shared'
import { describe, expect, it, vi } from 'vitest'

import { createDataCache, memoryStore } from '../server/utils/data-cache.ts'

const tagsOf = (value: unknown) => (value as { cacheTags: string[] }).cacheTags

function setup() {
  let pending: CacheChanges = { cursor: '1.1', all: true, tags: [] }
  const changes = vi.fn(async () => {
    const answer = pending
    pending = { cursor: '1.1', all: false, tags: [] }
    return answer
  })
  const cache = createDataCache({ store: memoryStore(), changes })
  let version = 0
  const fetch = vi.fn(async () => ({ version: (version += 1), cacheTags: ['content:a', 'list:post'] }))
  return {
    cache,
    fetch,
    changes,
    change: (next: Partial<CacheChanges>) => {
      pending = { cursor: '1.1', all: false, tags: [], ...next }
    },
    read: (cacheable = true) => cache.read('/resolve?path=/a/', fetch, tagsOf, cacheable),
  }
}

describe('the data cache', () => {
  it('keeps an answer under its tags, and gives it until one of them changes', async () => {
    const { read, change, fetch } = setup()
    expect(await read()).toEqual({ value: { version: 1, cacheTags: ['content:a', 'list:post'] }, hit: false })
    expect(await read()).toMatchObject({ value: { version: 1 }, hit: true })
    change({ tags: ['content:other'] })
    expect(await read()).toMatchObject({ value: { version: 1 }, hit: true })
    change({ tags: ['list:post'] })
    expect(await read()).toMatchObject({ value: { version: 2 }, hit: false })
    change({ all: true })
    expect(await read()).toMatchObject({ value: { version: 3 }, hit: false })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('never keeps or gives an answer for a signed-in person or a post password', async () => {
    const { read, fetch } = setup()
    await read()
    expect(await read(false)).toMatchObject({ value: { version: 2 }, hit: false })
    expect(await read(false)).toMatchObject({ value: { version: 3 }, hit: false })
    // What the visitor without cookies gets is still the first answer: the others were not kept.
    expect(await read()).toMatchObject({ value: { version: 1 }, hit: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('keeps nothing when the change log cannot be read', async () => {
    const { read, changes } = setup()
    changes.mockRejectedValue(new Error('api down'))
    await read()
    expect(await read()).toMatchObject({ hit: false })
  })

  it('keeps nothing that was fetched while a tag changed (it may be older than the change)', async () => {
    const { cache, change } = setup()
    let calls = 0
    const slow = async () => {
      calls += 1
      if (calls === 1) {
        // Another request looks at the change log while this answer is on its way.
        change({ tags: ['content:a'] })
        await cache.read('/other', async () => ({ cacheTags: [] }), tagsOf, true)
      }
      return { call: calls, cacheTags: ['content:a'] }
    }
    expect(await cache.read('/a', slow, tagsOf, true)).toMatchObject({ value: { call: 1 }, hit: false })
    expect(await cache.read('/a', slow, tagsOf, true)).toMatchObject({ value: { call: 2 }, hit: false })
    expect(await cache.read('/a', slow, tagsOf, true)).toMatchObject({ value: { call: 2 }, hit: true })
  })
})
