import { describe, expect, it } from 'vitest'

import { loginLocation, redirectFromQuery, redirectTarget } from '../app/utils/auth-redirect.ts'

describe('redirectFromQuery', () => {
  it('reads redirectTo, and WordPress redirect_to', () => {
    expect(redirectFromQuery({ redirectTo: '/admin/setup' })).toBe('/admin/setup')
    expect(redirectFromQuery({ redirect_to: '/admin/setup?x=1' })).toBe('/admin/setup?x=1')
  })

  it('prefers ours when both are given, and falls through to the other when ours is unsafe', () => {
    expect(redirectFromQuery({ redirectTo: '/a', redirect_to: '/b' })).toBe('/a')
    expect(redirectFromQuery({ redirectTo: '//evil.example', redirect_to: '/b' })).toBe('/b')
  })

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/%2F/evil.example',
    '/%5Cevil.example',
    'javascript:alert(1)',
    '/admin\r\nSet-Cookie: x=1',
    '',
  ])('refuses %j', (value) => {
    expect(redirectFromQuery({ redirectTo: value })).toBeUndefined()
  })

  it('refuses what is not a string (a repeated query name is an array)', () => {
    expect(redirectFromQuery({ redirectTo: ['/a', '/b'] })).toBeUndefined()
    expect(redirectFromQuery({ redirectTo: 5 })).toBeUndefined()
    expect(redirectFromQuery({})).toBeUndefined()
  })
})

describe('redirectTarget', () => {
  it('turns a path under the base into a route of the app', () => {
    expect(redirectTarget('/admin/setup', '/admin/')).toEqual({ kind: 'route', to: '/setup' })
    expect(redirectTarget('/admin/setup?x=1#y', '/admin')).toEqual({ kind: 'route', to: '/setup?x=1#y' })
    expect(redirectTarget('/admin', '/admin/')).toEqual({ kind: 'route', to: '/' })
    expect(redirectTarget('/admin/', '/admin/')).toEqual({ kind: 'route', to: '/' })
    expect(redirectTarget('/admin?x=1', '/admin')).toEqual({ kind: 'route', to: '/?x=1' })
  })

  it('makes a path outside the base a full page load (the site)', () => {
    expect(redirectTarget('/', '/admin/')).toEqual({ kind: 'external', href: '/' })
    expect(redirectTarget('/blog/post', '/admin/')).toEqual({ kind: 'external', href: '/blog/post' })
    // A look-alike is not under the base.
    expect(redirectTarget('/administrator', '/admin/')).toEqual({ kind: 'external', href: '/administrator' })
  })

  it('goes to the admin start page when there is no target or it is unsafe', () => {
    expect(redirectTarget(undefined, '/admin/')).toEqual({ kind: 'route', to: '/' })
    expect(redirectTarget('//evil.example', '/admin/')).toEqual({ kind: 'route', to: '/' })
    expect(redirectTarget('https://evil.example', '/admin/')).toEqual({ kind: 'route', to: '/' })
  })

  it('works with no base at all', () => {
    expect(redirectTarget('/setup', '/')).toEqual({ kind: 'route', to: '/setup' })
  })
})

describe('loginLocation', () => {
  it('brings a person back to the page they came from, with the base the API and the validator see', () => {
    expect(loginLocation('/setup', '/admin/')).toEqual({ path: '/login', query: { redirectTo: '/admin/setup' } })
    expect(loginLocation('/setup?x=1', '/admin')).toEqual({ path: '/login', query: { redirectTo: '/admin/setup?x=1' } })
  })

  it('has no target for the start page (it is the default) or for the sign-in screens themselves', () => {
    expect(loginLocation('/', '/admin/')).toEqual({ path: '/login' })
    expect(loginLocation('/login?action=lostpassword', '/admin/')).toEqual({ path: '/login' })
    expect(loginLocation('/register', '/admin/')).toEqual({ path: '/login' })
    expect(loginLocation('/logout', '/admin/')).toEqual({ path: '/login' })
  })

  it('gives no target that the shared validator would refuse', () => {
    expect(loginLocation('//evil.example/x', '/admin/')).toEqual({
      path: '/login',
      query: { redirectTo: '/admin//evil.example/x' },
    })
    // `/admin//evil.example/x` is a path on this site (one leading slash), which is all the validator promises.
  })
})
