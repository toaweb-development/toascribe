import { describe, expect, it } from 'vitest'

import { DEFAULT_REDIRECT, isSafeRedirectPath, safeRedirectPath } from '../src/index.ts'

describe('safeRedirectPath', () => {
  it.each([
    '/admin',
    '/',
    '/admin/',
    '/admin/profile',
    '/admin/posts?status=draft&page=2',
    '/admin/posts#comments',
    '/2026/10/21/hello-world/',
    '/search?q=100%25',
    '/a%20b',
    '/path/with%2Fencoded-slash',
    '/login?redirect_to=%2Fadmin',
    '/@user',
    '/a:b',
    '/a/../b',
    '/?next=//evil.com',
    '/?next=https://evil.com',
  ])('keeps the same-origin path %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path)
    expect(isSafeRedirectPath(path)).toBe(true)
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/admin'],
    ['three slashes', '///evil.com'],
    ['backslash after slash', '/\\evil.com'],
    ['backslash first', '\\\\evil.com'],
    ['backslash in the middle', '/admin\\..\\evil'],
    ['scheme without slashes', 'https:evil.com'],
    ['http absolute', 'http://evil.com/admin'],
    ['https absolute', 'https://evil.com'],
    ['absolute URL to our own host (not a path)', 'https://example.com/admin'],
    ['javascript', 'javascript:alert(1)'],
    ['JaVaScRiPt with a tab', 'java\tscript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['no leading slash', 'admin'],
    ['empty', ''],
    ['whitespace first', ' /admin'],
    ['space then double slash', ' //evil.com'],
    ['tab inside the slashes', '/\t/evil.com'],
    ['newline inside the slashes', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['NUL', '/admin\u0000'],
    ['DEL', '/admin\u007f'],
    ['C1 control', '/admin\u0085'],
    ['encoded slashes', '%2F%2Fevil.com'],
    ['slash, encoded slash', '/%2F/evil.com'],
    ['encoded backslash', '/%5Cevil.com'],
    ['encoded backslash, lower case', '/%5cevil.com'],
    ['encoded tab', '/%09/evil.com'],
    ['encoded newline', '/%0a/evil.com'],
    ['encoded NUL', '/%00'],
    ['double encoded slash', '/%252F/evil.com'],
    ['double encoded backslash', '/%255Cevil.com'],
    ['triple encoded slash', '/%25252F/evil.com'],
    ['four layers deep (more than we decode)', '/%2525252F/evil.com'],
    ['malformed escape', '/%zz'],
    ['truncated escape', '/admin%'],
    ['invalid UTF-8 escape', '/%E0%A4%A'],
    ['too long', `/${'a'.repeat(3000)}`],
  ])('refuses %s', (_name, input) => {
    expect(isSafeRedirectPath(input)).toBe(false)
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT)
  })

  it('falls back for anything that is not a string', () => {
    for (const input of [undefined, null, 42, {}, ['/admin'], true]) {
      expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT)
    }
  })

  it('takes a caller-chosen fallback', () => {
    expect(safeRedirectPath('//evil.com', '/')).toBe('/')
    expect(safeRedirectPath(undefined, '/login')).toBe('/login')
  })

  it('falls back to /admin', () => {
    expect(DEFAULT_REDIRECT).toBe('/admin')
  })
})
