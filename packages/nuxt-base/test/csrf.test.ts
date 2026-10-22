import { describe, expect, it } from 'vitest'

import { createCsrfStore, isPublicPath, isStateChanging, pathOf, tokenFromAnswer } from '../app/lib/api/csrf.ts'

describe('the CSRF store', () => {
  it('holds a token in memory, and an empty one is no token', () => {
    const store = createCsrfStore()
    expect(store.get()).toBeUndefined()
    store.set('abc')
    expect(store.get()).toBe('abc')
    store.set('')
    expect(store.get()).toBeUndefined()
    store.set('abc')
    store.set(undefined)
    expect(store.get()).toBeUndefined()
  })

  it('is one store for each call of createCsrfStore (nothing is shared between requests on the server)', () => {
    const a = createCsrfStore()
    const b = createCsrfStore()
    a.set('x')
    expect(b.get()).toBeUndefined()
  })
})

describe('isStateChanging', () => {
  it.each(['POST', 'patch', 'PUT', 'DELETE'])('%s changes state', (method) => {
    expect(isStateChanging(method)).toBe(true)
  })
  it.each(['GET', 'head', 'OPTIONS', undefined])('%s does not', (method) => {
    expect(isStateChanging(method)).toBe(false)
  })
})

describe('pathOf', () => {
  it('drops the query and the fragment, and only reads strings', () => {
    expect(pathOf('/v1/auth/session?x=1#y')).toBe('/v1/auth/session')
    expect(pathOf(new URL('http://x/y'))).toBe('')
  })
})

describe('isPublicPath', () => {
  it.each([
    '/v1/auth/login',
    '/v1/auth/register',
    '/v1/auth/password/lost',
    '/api/v1/auth/password/reset',
    '/v1/auth/password/set',
  ])('%s has no session to protect', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })
  it.each(['/v1/auth/logout', '/v1/auth/mfa/verify', '/v1/me', '/v1/me/mfa/totp', '/v1/me/email-change/confirm'])(
    '%s has one',
    (path) => {
      expect(isPublicPath(path)).toBe(false)
    },
  )
})

describe('tokenFromAnswer', () => {
  it('takes csrfToken from the three answers that carry it, under the API base too', () => {
    expect(tokenFromAnswer('/api/v1/auth/session', { status: 'authenticated', csrfToken: 't' })).toBe('t')
    expect(tokenFromAnswer('/v1/auth/login', { status: 'mfa_required', csrfToken: 'u' })).toBe('u')
    expect(tokenFromAnswer('/v1/auth/mfa/verify', { status: 'authenticated', csrfToken: 'v' })).toBe('v')
  })

  it('says null for anonymous: the held token is dead', () => {
    expect(tokenFromAnswer('/v1/auth/session', { status: 'anonymous' })).toBeNull()
  })

  it('says nothing about other answers, and ignores a token that is not a non-empty string', () => {
    expect(tokenFromAnswer('/v1/me', { csrfToken: 't' })).toBeUndefined()
    expect(tokenFromAnswer('/v1/auth/session', { status: 'authenticated', csrfToken: 5 })).toBeUndefined()
    expect(tokenFromAnswer('/v1/auth/session', { status: 'authenticated', csrfToken: '' })).toBeUndefined()
    expect(tokenFromAnswer('/v1/auth/session', null)).toBeUndefined()
    expect(tokenFromAnswer('/v1/auth/session', 'text')).toBeUndefined()
  })
})
