import { describe, expect, it, vi } from 'vitest'

import { hashForToken, takeTokenFromAddress, tokenFromHash, withoutFragment } from '../app/utils/token-fragment.ts'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 characters, as generateToken() makes them

describe('tokenFromHash', () => {
  it('reads the token of a mail link', () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash(`token=${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash(`#other=1&token=${TOKEN}`)).toBe(TOKEN)
  })

  it.each([
    '',
    '#',
    '#token=',
    '#token=short',
    '#token=has spaces in it is not a token at all 12345',
    '#tok=abc',
    '#token=<script>',
    `#token=${TOKEN}${TOKEN}${TOKEN}`,
  ])('finds no token in %j', (hash) => {
    expect(tokenFromHash(hash)).toBeUndefined()
  })
})

describe('hashForToken', () => {
  it('makes the fragment tokenFromHash reads', () => {
    expect(tokenFromHash(hashForToken(TOKEN))).toBe(TOKEN)
  })
})

describe('withoutFragment', () => {
  it('keeps the path and the query', () => {
    expect(withoutFragment({ pathname: '/admin/login', search: '?action=resetpass' })).toBe(
      '/admin/login?action=resetpass',
    )
    expect(withoutFragment({ pathname: '/admin/login', search: '' })).toBe('/admin/login')
  })
})

describe('takeTokenFromAddress', () => {
  function fakeWindow(hash: string) {
    const replaceState = vi.fn()
    return {
      replaceState,
      win: {
        location: { hash, pathname: '/admin/login', search: '?action=resetpass' },
        history: { state: { position: 3 }, replaceState },
      },
    }
  }

  it('returns the token and replaces the address (no new history entry) with one without the fragment', () => {
    const { win, replaceState } = fakeWindow(`#token=${TOKEN}`)
    expect(takeTokenFromAddress(win)).toBe(TOKEN)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith({ position: 3 }, '', '/admin/login?action=resetpass')
  })

  it('takes the fragment out even when it holds no usable token', () => {
    const { win, replaceState } = fakeWindow('#token=nonsense')
    expect(takeTokenFromAddress(win)).toBeUndefined()
    expect(replaceState).toHaveBeenCalledOnce()
  })

  it('does nothing to an address that has no fragment', () => {
    const { win, replaceState } = fakeWindow('')
    expect(takeTokenFromAddress(win)).toBeUndefined()
    expect(replaceState).not.toHaveBeenCalled()
  })
})
