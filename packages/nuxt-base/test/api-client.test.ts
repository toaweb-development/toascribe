import { ofetch } from 'ofetch'
import { describe, expect, it, vi } from 'vitest'

import { createApiClient } from '../app/lib/api/client.ts'
import type { ApiCall, FetchDefaults } from '../app/lib/api/client.ts'
import { createCsrfStore } from '../app/lib/api/csrf.ts'
import { ApiRequestError } from '../app/lib/api/errors.ts'

// The client runs on the real ofetch (the one Nuxt's $fetch is), with only the network faked: a request the fake sees is
// exactly what the browser would send.

interface Seen {
  url: string
  method: string
  headers: Headers
  body: string | undefined
  credentials: string | undefined
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> }

function setup(
  replies: Record<string, Reply | ((seen: Seen) => Reply)>,
  options: { isClient?: boolean; cookie?: string } = {},
) {
  const seen: Seen[] = []
  const network = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const entry: Seen = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      credentials: init?.credentials,
    }
    seen.push(entry)
    const path = new URL(url, 'http://x').pathname
    const found = replies[`${entry.method} ${path}`]
    const reply =
      typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { error: { code: 'not_found' } } })
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    })
  })
  const csrf = createCsrfStore()
  const onUnauthorized = vi.fn()
  const api: ApiCall = createApiClient({
    create: (defaults: FetchDefaults) => ofetch.create(defaults as never, { fetch: network as never }) as never,
    baseURL: '/api',
    headers: options.cookie === undefined ? undefined : { cookie: options.cookie },
    csrf,
    isClient: options.isClient ?? true,
    onUnauthorized,
  })
  return { api, csrf, seen, onUnauthorized }
}

const SESSION = {
  status: 'authenticated',
  csrfToken: 'token-1',
  account: {},
  expiresAt: '2030-01-01T00:00:00Z',
}

describe('the API client', () => {
  it('sends the cookie along, and on the server forwards the one of the page request', async () => {
    const { api, seen } = setup(
      { 'GET /api/v1/auth/session': { body: { status: 'anonymous' } } },
      { cookie: '__Host-toa_session=abc' },
    )
    await api('/v1/auth/session')
    expect(seen[0]?.credentials).toBe('include')
    expect(seen[0]?.headers.get('cookie')).toBe('__Host-toa_session=abc')
  })

  it('learns the CSRF token from the session, login and verify answers, and sends it on a write', async () => {
    const { api, csrf, seen } = setup({
      'GET /api/v1/auth/session': { body: SESSION },
      'POST /api/v1/me/mfa/totp': { status: 201, body: {} },
    })
    await api('/v1/auth/session')
    expect(csrf.get()).toBe('token-1')
    await api('/v1/me/mfa/totp', { method: 'POST', body: {} })
    expect(seen[1]?.headers.get('x-csrf-token')).toBe('token-1')
    expect(seen[1]?.headers.get('content-type')).toBe('application/json')
  })

  it.each(['/v1/auth/login', '/v1/auth/mfa/verify'])('takes the token from %s', async (path) => {
    const { api, csrf } = setup({ [`POST /api${path}`]: { body: { status: 'mfa_required', csrfToken: 'fresh' } } })
    await api(path, { method: 'POST', body: {} })
    expect(csrf.get()).toBe('fresh')
  })

  it('drops the token when the session answer says nobody is signed in', async () => {
    const { api, csrf } = setup({ 'GET /api/v1/auth/session': { body: { status: 'anonymous' } } })
    csrf.set('old')
    await api('/v1/auth/session')
    expect(csrf.get()).toBeUndefined()
  })

  it('does not send a token with the login call, which makes the session', async () => {
    const { api, csrf, seen } = setup({
      'POST /api/v1/auth/login': { body: { status: 'authenticated', csrfToken: 'new' } },
    })
    csrf.set('stale')
    await api('/v1/auth/login', { method: 'POST', body: { login: 'a', password: 'b' } })
    expect(seen[0]?.headers.has('x-csrf-token')).toBe(false)
  })

  it('fetches the token first when a write comes after a reload (no token held)', async () => {
    const { api, seen } = setup({
      'GET /api/v1/auth/session': { body: SESSION },
      'POST /api/v1/auth/logout': { status: 204 },
    })
    await api('/v1/auth/logout', { method: 'POST' })
    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'GET /api/v1/auth/session',
      'POST /api/v1/auth/logout',
    ])
    expect(seen[1]?.headers.get('x-csrf-token')).toBe('token-1')
  })

  it('does not fetch a token for a call that has no session to protect', async () => {
    const { api, seen } = setup({ 'POST /api/v1/auth/password/lost': { status: 202, body: { status: 'accepted' } } })
    await api('/v1/auth/password/lost', { method: 'POST', body: { login: 'a' } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers.has('x-csrf-token')).toBe(false)
  })

  it('never changes anything from the server, so it does not fetch a token there', async () => {
    const { api, seen } = setup({ 'POST /api/v1/auth/logout': { status: 204 } }, { isClient: false })
    await api('/v1/auth/logout', { method: 'POST' })
    expect(seen).toHaveLength(1)
  })

  it('does not send a token on a read', async () => {
    const { api, csrf, seen } = setup({ 'GET /api/v1/auth/options': { body: { registrationOpen: false } } })
    csrf.set('token-1')
    await api('/v1/auth/options')
    expect(seen[0]?.headers.has('x-csrf-token')).toBe(false)
  })

  it('turns an error answer into an ApiRequestError with the code, the request id and Retry-After', async () => {
    const { api } = setup({
      'POST /api/v1/auth/login': {
        status: 429,
        body: { error: { code: 'too_many_requests', message: 'Too many', requestId: 'req-1' } },
        headers: { 'retry-after': '90' },
      },
    })
    const error = await api('/v1/auth/login', { method: 'POST', body: {} }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 429, code: 'too_many_requests', requestId: 'req-1', retryAfterSeconds: 90 })
  })

  it('reports a lost session to onUnauthorized, once, and forgets the token', async () => {
    const { api, csrf, onUnauthorized } = setup({
      'PATCH /api/v1/me': { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } },
    })
    csrf.set('token-1')
    await expect(api('/v1/me', { method: 'PATCH', body: {} })).rejects.toBeInstanceOf(ApiRequestError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(csrf.get()).toBeUndefined()
  })

  it('reports a half-open session (mfa_required) the same way', async () => {
    const { api, onUnauthorized } = setup({
      'GET /api/v1/me': { status: 401, body: { error: { code: 'mfa_required', message: 'x' } } },
    })
    await expect(api('/v1/me')).rejects.toBeInstanceOf(ApiRequestError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it.each([
    ['/v1/auth/login', 'invalid_credentials'],
    ['/v1/auth/mfa/verify', 'unauthorized'],
  ])('does not treat a 401 from %s as a lost session', async (path, code) => {
    const { api, onUnauthorized } = setup({
      [`POST /api${path}`]: { status: 401, body: { error: { code, message: 'x' } } },
    })
    await expect(api(path, { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, code })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('does not treat a 403 as a lost session (a wrong password or code from a signed-in person is a 403)', async () => {
    const { api, onUnauthorized } = setup({
      'POST /api/v1/me/mfa/recovery-codes': {
        status: 403,
        body: { error: { code: 'invalid_password', message: 'x' } },
      },
    })
    await expect(api('/v1/me/mfa/recovery-codes', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'invalid_password',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('makes a failed connection a `network` error', async () => {
    const failing = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    const api = createApiClient({
      create: (defaults) => ofetch.create(defaults as never, { fetch: failing as never }) as never,
      baseURL: '/api',
      csrf: createCsrfStore(),
      isClient: true,
    })
    await expect(api('/v1/auth/session')).rejects.toMatchObject({ code: 'network', status: undefined })
  })
})
