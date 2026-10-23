import { ofetch } from 'ofetch'
import { describe, expect, it, vi } from 'vitest'

import { createApiClient } from '../app/lib/api/client.ts'
import type { ApiCall, FetchDefaults } from '../app/lib/api/client.ts'
import { createCsrfStore, isPublicPath } from '../app/lib/api/csrf.ts'
import { describeApiError } from '../app/lib/api/error-message.ts'
import type { Translate } from '../app/lib/api/error-message.ts'
import { ApiRequestError } from '../app/lib/api/errors.ts'
import { TEST_EMAIL_TIMEOUT_MS, createSetupApi } from '../app/lib/api/setup.ts'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

interface Seen {
  method: string
  path: string
  headers: Headers
  body: string | undefined
}

type Reply = { status?: number; body?: unknown }

// The setup API layer on the real client and the real ofetch, with only the network faked: what the fake sees is what the
// browser would send.
function setup(replies: Record<string, Reply>) {
  const seen: Seen[] = []
  const timeouts: (number | undefined)[] = []
  const network = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x')
    const method = init?.method ?? 'GET'
    seen.push({
      method,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const reply = replies[`${method} ${url.pathname}`] ?? { status: 404, body: { error: { code: 'not_found' } } }
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const csrf = createCsrfStore()
  const api: ApiCall = createApiClient({
    create: (defaults: FetchDefaults) => {
      const instance = ofetch.create(defaults as never, { fetch: network as never })
      return ((path: string, options?: { timeout?: number }) => {
        timeouts.push(options?.timeout)
        return instance(path, options as never)
      }) as never
    },
    baseURL: '/api',
    csrf,
    isClient: true,
  })
  return { setupApi: createSetupApi(api), seen, timeouts }
}

const SITE = {
  locale: 'nb',
  title: 'Mitt nettsted',
  timezone: 'Europe/Oslo',
  adminEmail: 'meg@example.test',
  blogPublic: true,
}

describe('the setup API layer', () => {
  it('asks for the status without a token', async () => {
    const { setupApi, seen } = setup({ 'GET /api/v1/setup/status': { body: { installed: false, nextStep: 'check' } } })
    expect(await setupApi.status()).toEqual({ installed: false, nextStep: 'check' })
    expect(seen[0]?.headers.has('x-setup-token')).toBe(false)
  })

  it('sends the setup code in the X-Setup-Token header and never in the address', async () => {
    const { setupApi, seen } = setup({
      'GET /api/v1/setup/state': { body: { nextStep: 'site', site: null, email: null, emailSkipped: false } },
      'POST /api/v1/setup/token/verify': { body: { valid: true, nextStep: 'check' } },
      'GET /api/v1/setup/check': {
        body: {
          ok: true,
          database: { ok: true },
          migrations: { ok: true, applied: 7, expected: 7, latest: '0006' },
          encryptionKey: { ok: true, version: 1 },
          signingKey: { ok: true },
          proxy: { state: 'ok', observed: 3, address: null },
          origin: { ok: true, configured: 'http://localhost', observed: 'http://localhost', source: 'referer' },
        },
      },
    })
    await setupApi.state(TOKEN)
    await setupApi.verifyToken(TOKEN)
    await setupApi.check(TOKEN)
    expect(seen).toHaveLength(3)
    for (const entry of seen) {
      expect(entry.headers.get('x-setup-token')).toBe(TOKEN)
      expect(entry.path).not.toContain(TOKEN)
    }
  })

  it('needs no CSRF token and so asks for no session first: the setup code takes its place', async () => {
    const { setupApi, seen } = setup({
      'PUT /api/v1/setup/site': { body: { site: SITE, nextStep: 'email' } },
      'POST /api/v1/setup/email/skip': { body: { skipped: true, nextStep: 'admin' } },
    })
    await setupApi.saveSite(TOKEN, SITE)
    await setupApi.skipEmail(TOKEN)
    expect(seen.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'PUT /api/v1/setup/site',
      'POST /api/v1/setup/email/skip',
    ])
    expect(seen.every((entry) => !entry.headers.has('x-csrf-token'))).toBe(true)
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual(SITE)
  })

  it('waits longer for the test mail, which waits for the worker', async () => {
    const { setupApi, timeouts } = setup({ 'POST /api/v1/setup/email/test': { body: { ok: true } } })
    expect(await setupApi.testEmail(TOKEN, 'a@example.test')).toEqual({ ok: true })
    expect(timeouts[0]).toBe(TEST_EMAIL_TIMEOUT_MS)
    expect(TEST_EMAIL_TIMEOUT_MS).toBeGreaterThan(30_000)
  })

  it('reads a failed test mail as a result with a reason, not as an error', async () => {
    const { setupApi } = setup({ 'POST /api/v1/setup/email/test': { body: { ok: false, error: 'send_failed' } } })
    expect(await setupApi.testEmail(TOKEN, 'a@example.test')).toEqual({ ok: false, error: 'send_failed' })
  })

  it('refuses an answer that is not the shared shape', async () => {
    const { setupApi } = setup({ 'POST /api/v1/setup/recovery-key': { body: { recoveryKey: 'not a key' } } })
    await expect(setupApi.recoveryKey(TOKEN)).rejects.toThrow()
  })

  it('sends the install body as it is', async () => {
    const { setupApi, seen } = setup({
      'POST /api/v1/setup/install': { body: { installed: true, login: null } },
    })
    await setupApi.install(TOKEN, {
      admin: { username: 'tor', email: 'tor@example.test', password: 'a long enough password' },
      recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789',
      confirmed: true,
    })
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
      admin: { username: 'tor', email: 'tor@example.test', password: 'a long enough password' },
      recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789',
      confirmed: true,
    })
  })

  it('turns the errors of the api into ApiRequestError with the code', async () => {
    const { setupApi } = setup({
      'GET /api/v1/setup/state': {
        status: 401,
        body: { error: { code: 'invalid_setup_token', message: 'x', requestId: 'r' } },
      },
    })
    await expect(setupApi.state('nope')).rejects.toMatchObject({ status: 401, code: 'invalid_setup_token' })
  })
})

describe('isPublicPath', () => {
  it('counts every setup path as one with no session to protect', () => {
    for (const path of ['/v1/setup/status', '/v1/setup/site', '/v1/setup/email/test', '/v1/setup/install']) {
      expect(isPublicPath(path)).toBe(true)
    }
    expect(isPublicPath('/v1/me/mfa/totp')).toBe(false)
    expect(isPublicPath('/v1/auth/logout')).toBe(false)
  })
})

describe('the messages for the setup errors', () => {
  const t: Translate = (key) => key
  it.each([
    ['setup_token_required', 'error.setupTokenRequired'],
    ['invalid_setup_token', 'error.invalidSetupToken'],
    ['already_installed', 'error.alreadyInstalled'],
    ['step_missing', 'error.stepMissing'],
    ['username_taken', 'error.usernameTaken'],
    ['email_taken', 'error.emailTaken'],
    ['content_exists', 'error.contentExists'],
    ['recovery_key_mismatch', 'error.recoveryKeyMismatch'],
  ])('maps %s', (code, key) => {
    expect(describeApiError(new ApiRequestError({ code }), t)).toBe(key)
  })
})
