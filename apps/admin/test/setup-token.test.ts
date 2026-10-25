import { describe, expect, it } from 'vitest'

import {
  SETUP_TOKEN_STORAGE_KEY,
  clearStoredToken,
  readStoredToken,
  storeToken,
  takeTokenFromHash,
  withoutTokenQuery,
} from '../app/utils/setup-token.ts'
import type { TokenStorage } from '../app/utils/setup-token.ts'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 characters, as the api makes them

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

const broken: TokenStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('takeTokenFromHash', () => {
  it('takes the code out of the fragment and leaves the rest', () => {
    expect(takeTokenFromHash(`#token=${TOKEN}`)).toEqual({ token: TOKEN, present: true, rest: '' })
    expect(takeTokenFromHash(`#token=${TOKEN}&keep=me`)).toEqual({ token: TOKEN, present: true, rest: '#keep=me' })
    expect(takeTokenFromHash(`token=${TOKEN}`).token).toBe(TOKEN)
  })

  it('removes a `token` that cannot be a code too, and says there was one', () => {
    for (const token of ['', 'short', '<script>', `${TOKEN}${TOKEN}${TOKEN}`]) {
      expect(takeTokenFromHash(`#token=${encodeURIComponent(token)}`)).toEqual({
        token: undefined,
        present: true,
        rest: '',
      })
    }
  })

  it('takes the first of several', () => {
    expect(takeTokenFromHash(`#token=${TOKEN}&token=x`).token).toBe(TOKEN)
  })

  it('finds nothing in a fragment without `token`, or without a fragment', () => {
    expect(takeTokenFromHash('#other=1')).toEqual({ token: undefined, present: false, rest: '#other=1' })
    expect(takeTokenFromHash('#section')).toEqual({ token: undefined, present: false, rest: '#section' })
    expect(takeTokenFromHash('')).toEqual({ token: undefined, present: false, rest: '' })
  })
})

describe('the code kept for this tab', () => {
  it('is stored, read back and cleared', () => {
    const storage = memoryStorage()
    expect(readStoredToken(storage)).toBeUndefined()
    storeToken(TOKEN, storage)
    expect(storage.values.get(SETUP_TOKEN_STORAGE_KEY)).toBe(TOKEN)
    expect(readStoredToken(storage)).toBe(TOKEN)
    clearStoredToken(storage)
    expect(readStoredToken(storage)).toBeUndefined()
  })

  it('ignores a stored value that cannot be a code', () => {
    expect(readStoredToken(memoryStorage({ [SETUP_TOKEN_STORAGE_KEY]: 'garbage with spaces' }))).toBeUndefined()
  })

  it('works without storage and with storage that refuses (private window, blocked site data)', () => {
    expect(readStoredToken(broken)).toBeUndefined()
    expect(() => storeToken(TOKEN, broken)).not.toThrow()
    expect(() => clearStoredToken(broken)).not.toThrow()
    expect(() => storeToken(TOKEN, undefined)).not.toThrow()
  })
})

describe('withoutTokenQuery', () => {
  it('drops a token parameter and keeps the others, whatever its value is', () => {
    expect(withoutTokenQuery({ token: TOKEN, lang: 'nb' })).toEqual({ query: { lang: 'nb' }, removed: true })
    expect(withoutTokenQuery({ token: ['a', 'b'] })).toEqual({ query: {}, removed: true })
    expect(withoutTokenQuery({ token: null })).toEqual({ query: {}, removed: true })
    expect(withoutTokenQuery({ token: '' })).toEqual({ query: {}, removed: true })
  })

  it('says nothing was removed when there was no token parameter', () => {
    const query = { tokens: '1', lang: 'nb' }
    expect(withoutTokenQuery(query)).toEqual({ query, removed: false })
    expect(withoutTokenQuery({})).toEqual({ query: {}, removed: false })
  })

  it('does not change the object it was given', () => {
    const query = { token: TOKEN, lang: 'nb' }
    withoutTokenQuery(query)
    expect(query).toEqual({ token: TOKEN, lang: 'nb' })
  })
})
