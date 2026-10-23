import { describe, expect, it } from 'vitest'

import {
  SETUP_TOKEN_STORAGE_KEY,
  clearStoredToken,
  readStoredToken,
  storeToken,
  takeTokenFromQuery,
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

describe('takeTokenFromQuery', () => {
  it('takes the code out of the query and leaves the rest', () => {
    expect(takeTokenFromQuery({ token: TOKEN, keep: 'me' })).toEqual({
      token: TOKEN,
      present: true,
      rest: { keep: 'me' },
    })
  })

  it('removes a `token` that cannot be a code too, and says there was one', () => {
    for (const token of ['', 'short', '<script>', `${TOKEN}${TOKEN}${TOKEN}`]) {
      expect(takeTokenFromQuery({ token })).toEqual({ token: undefined, present: true, rest: {} })
    }
  })

  it('takes the first of several', () => {
    expect(takeTokenFromQuery({ token: [TOKEN, 'x'] }).token).toBe(TOKEN)
  })

  it('finds nothing in a query without `token`', () => {
    expect(takeTokenFromQuery({ other: '1' })).toEqual({ token: undefined, present: false, rest: { other: '1' } })
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
