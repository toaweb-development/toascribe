// K-314 (the api's part): security headers, HSTS only over HTTPS, no caching of anything about a person.
import { describe, expect, it } from 'vitest'

import { UNREACHABLE_DATABASE_URL, makeApp } from './helpers.ts'

describe('security headers', () => {
  it('sends the strict API policy and the baseline on a successful response', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const res = await app.request('/api/health')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('permissions-policy')).toContain('camera=()')
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  it('sends HSTS when PUBLIC_ORIGIN is https', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL, { publicOrigin: 'https://example.com' })
    const res = await app.request('/api/health')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
  })

  it('does not send HSTS when PUBLIC_ORIGIN is http (local development)', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL, { publicOrigin: 'http://localhost:8080' })
    for (const path of ['/api/health', '/api/v1/auth/session', '/api/nope']) {
      const res = await app.request(path)
      expect(res.headers.get('strict-transport-security'), path).toBeNull()
      // The rest stays.
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    }
  })

  it('also sends them on errors', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    for (const [method, path] of [
      ['GET', '/api/v1/me'],
      ['GET', '/api/nope'],
      ['POST', '/api/v1/auth/login'],
    ] as const) {
      const res = await app.request(path, { method })
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
    }
  })
})

describe('Cache-Control: no-store (security §3, §7)', () => {
  it.each([
    ['GET', '/api/v1/auth/session'],
    ['GET', '/api/v1/me'],
    ['GET', '/api/v1/me/sessions'],
    ['PATCH', '/api/v1/me'],
    ['PATCH', '/api/v1/me/preferences'],
    ['GET', '/api/v1/admin/menu'],
    ['GET', '/api/v1/dashboard/glance'],
    ['GET', '/api/v1/notices'],
    ['GET', '/api/v1/users'],
    ['PUT', '/api/v1/users/roles'],
    ['GET', '/api/v1/content?type=post'],
    ['GET', '/api/v1/content/0198a3c2-0000-7000-8000-0000000000ee'],
    ['GET', '/api/v1/media'],
    ['POST', '/api/v1/notices/some.key/dismiss'],
    ['DELETE', '/api/v1/me/sessions'],
    ['DELETE', '/api/v1/me/sessions/0198a3c2-0000-7000-8000-000000000000'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/login'], // refused for its origin, before the handler
    ['GET', '/api/v1/auth/unknown'], // a 404 under /auth
    ['GET', '/api/v1/me/unknown'],
  ])('%s %s carries it, whatever the answer', async (method, path) => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const res = await app.request(path, { method })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('is not forced on the public health check', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    expect((await app.request('/api/health')).headers.get('cache-control')).toBeNull()
  })
})

describe('the OpenAPI document', () => {
  it('lists the new endpoints with their methods and the shared error format, and carries no internal fields', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const res = await app.request('/api/v1/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, Record<string, Record<string, unknown>>> }
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        '/api/health',
        '/api/ready',
        '/api/v1/admin/menu',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/mfa/verify',
        '/api/v1/auth/options',
        '/api/v1/auth/password/lost',
        '/api/v1/auth/password/reset',
        '/api/v1/auth/password/set',
        '/api/v1/auth/register',
        '/api/v1/auth/session',
        '/api/v1/content',
        '/api/v1/content/authors',
        '/api/v1/content/bulk',
        '/api/v1/content/{id}',
        '/api/v1/content/{id}/preview-link',
        '/api/v1/content/{id}/publish',
        '/api/v1/content/{id}/restore',
        '/api/v1/content/{id}/trash',
        '/api/v1/dashboard/glance',
        '/api/v1/global-sets',
        '/api/v1/global-sets/choices',
        '/api/v1/global-sets/{id}',
        '/api/v1/me',
        '/api/v1/me/email-change',
        '/api/v1/me/email-change/confirm',
        '/api/v1/me/mfa',
        '/api/v1/me/mfa/recovery-codes',
        '/api/v1/me/mfa/totp',
        '/api/v1/me/mfa/totp/{id}/confirm',
        '/api/v1/me/mfa/{id}',
        '/api/v1/me/password',
        '/api/v1/me/preferences',
        '/api/v1/me/sessions',
        '/api/v1/me/sessions/{id}',
        '/api/v1/media',
        '/api/v1/media-folders',
        '/api/v1/media-folders/{id}',
        '/api/v1/media/from-url',
        '/api/v1/media/regenerate',
        '/api/v1/media/{id}',
        '/api/v1/media/{id}/edit',
        '/api/v1/media/{id}/file',
        '/api/v1/media/{id}/replace',
        '/api/v1/menu-locations',
        '/api/v1/menus',
        '/api/v1/menus/{id}',
        '/api/v1/notices',
        '/api/v1/notices/{key}/dismiss',
        '/api/v1/public/cache/changes',
        '/api/v1/public/global-sets/{slug}',
        '/api/v1/public/menus/{location}',
        '/api/v1/public/preview',
        '/api/v1/public/query',
        '/api/v1/public/resolve',
        '/api/v1/public/settings',
        '/api/v1/public/unlock',
        '/api/v1/settings/general',
        '/api/v1/settings/general/admin-email/confirm',
        '/api/v1/settings/media',
        '/api/v1/settings/permalinks',
        '/api/v1/settings/privacy',
        '/api/v1/settings/reading',
        '/api/v1/settings/writing',
        '/api/v1/setup/check',
        '/api/v1/setup/email',
        '/api/v1/setup/email/skip',
        '/api/v1/setup/email/test',
        '/api/v1/setup/install',
        '/api/v1/setup/recovery-key',
        '/api/v1/setup/site',
        '/api/v1/setup/state',
        '/api/v1/setup/status',
        '/api/v1/setup/token/verify',
        '/api/v1/system/test-email',
        '/api/v1/taxonomies',
        '/api/v1/taxonomies/{tax}/terms',
        '/api/v1/taxonomies/{tax}/terms/bulk',
        '/api/v1/taxonomies/{tax}/terms/{id}',
        '/api/v1/users',
        '/api/v1/users/roles',
      ].sort(),
    )
    expect(Object.keys(doc.paths['/api/v1/me'] ?? {}).sort()).toEqual(['get', 'patch'])
    expect(Object.keys(doc.paths['/api/v1/me/sessions'] ?? {}).sort()).toEqual(['delete', 'get'])
    const text = JSON.stringify(doc)
    expect(text).not.toContain('"policy"')
    expect(text).not.toContain('bodyType')
    expect(text).not.toContain('/u"') // no JavaScript regex flags inside a pattern
    expect(text).toContain('X-CSRF-Token')
    // Each operation says who may call it.
    expect(doc.paths['/api/v1/me']?.['get']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/auth/login']?.['post']?.['x-policy']).toBe('public')
    expect(doc.paths['/api/v1/setup/status']?.['get']?.['x-policy']).toBe('public')
    expect(doc.paths['/api/v1/setup/install']?.['post']?.['x-policy']).toBe('setup-token')
    expect(doc.paths['/api/v1/auth/logout']?.['post']?.['x-policy']).toBe('authenticated')
    expect(doc.paths['/api/v1/system/test-email']?.['post']?.['x-policy']).toBe('capability:manage_options')
    expect(doc.paths['/api/v1/users']?.['get']?.['x-policy']).toBe('capability:list_users')
    expect(doc.paths['/api/v1/users/roles']?.['put']?.['x-policy']).toBe('capability:promote_users')
    expect(doc.paths['/api/v1/admin/menu']?.['get']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/me/preferences']?.['patch']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/dashboard/glance']?.['get']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/notices/{key}/dismiss']?.['post']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/health']?.['get']?.['x-policy']).toBe('public')
    // The account flows: the public ones are public, the second step may be taken half signed in, the rest need `read`.
    for (const path of [
      '/api/v1/auth/password/lost',
      '/api/v1/auth/password/reset',
      '/api/v1/auth/password/set',
      '/api/v1/auth/register',
    ]) {
      expect(doc.paths[path]?.['post']?.['x-policy'], path).toBe('public')
    }
    expect(doc.paths['/api/v1/auth/options']?.['get']?.['x-policy']).toBe('public')
    expect(doc.paths['/api/v1/auth/mfa/verify']?.['post']?.['x-policy']).toBe('authenticated')
    expect(doc.paths['/api/v1/me/mfa/totp']?.['post']?.['x-policy']).toBe('authenticated')
    expect(doc.paths['/api/v1/me/mfa/{id}']?.['delete']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/me/password']?.['patch']?.['x-policy']).toBe('capability:read')
    expect(doc.paths['/api/v1/me/email-change/confirm']?.['post']?.['x-policy']).toBe('capability:read')
  })
})
