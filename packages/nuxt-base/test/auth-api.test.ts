import { describe, expect, it, vi } from 'vitest'

import { createAuthApi } from '../app/lib/api/auth.ts'
import { toSessionView } from '../app/lib/api/session.ts'

const ACCOUNT = {
  id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
  username: 'alice',
  email: 'alice@example.test',
  displayName: 'alice',
  locale: null,
  roles: ['editor'],
  capabilities: ['read'],
}
const EXPIRES = '2030-01-01T00:00:00Z'

describe('the auth API layer', () => {
  it('asks the versioned endpoints, with JSON bodies', async () => {
    const api = vi.fn().mockResolvedValue({ status: 'accepted' })
    const auth = createAuthApi(api)

    await auth.lostPassword('alice')
    await auth.register('alice', 'alice@example.test')
    expect(api).toHaveBeenNthCalledWith(1, '/v1/auth/password/lost', { method: 'POST', body: { login: 'alice' } })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/auth/register', {
      method: 'POST',
      body: { username: 'alice', email: 'alice@example.test' },
    })
  })

  it('sends redirectTo only when there is one', async () => {
    const answer = {
      status: 'authenticated',
      csrfToken: 't',
      account: ACCOUNT,
      expiresAt: EXPIRES,
      redirectTo: '/admin',
    }
    const api = vi.fn().mockResolvedValue(answer)
    const auth = createAuthApi(api)

    await auth.login({ login: 'alice', password: 'pw', remember: true })
    await auth.login({ login: 'alice', password: 'pw', remember: false, redirectTo: '/admin/setup' })
    expect(api).toHaveBeenNthCalledWith(1, '/v1/auth/login', {
      method: 'POST',
      body: { login: 'alice', password: 'pw', remember: true },
    })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/auth/login', {
      method: 'POST',
      body: { login: 'alice', password: 'pw', remember: false, redirectTo: '/admin/setup' },
    })
  })

  it('puts the token of a reset or set-password link in the body, never in the address', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    const auth = createAuthApi(api)
    await auth.resetPassword('T'.repeat(43), 'a new password')
    await auth.setPassword('S'.repeat(43), 'a first password')
    expect(api).toHaveBeenNthCalledWith(1, '/v1/auth/password/reset', {
      method: 'POST',
      body: { token: 'T'.repeat(43), password: 'a new password' },
    })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/auth/password/set', {
      method: 'POST',
      body: { token: 'S'.repeat(43), password: 'a first password' },
    })
  })

  it('encodes the factor id of the confirm call', async () => {
    const api = vi.fn().mockResolvedValue({
      factor: {
        id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
        type: 'totp',
        name: null,
        createdAt: EXPIRES,
        lastUsedAt: null,
      },
      recoveryCodes: null,
      loginCompleted: true,
    })
    await createAuthApi(api).enrolConfirm('a/b', '123456')
    expect(api).toHaveBeenCalledWith('/v1/me/mfa/totp/a%2Fb/confirm', { method: 'POST', body: { code: '123456' } })
  })

  it('sends the password with the first code in a complete session, where the API requires it', async () => {
    const api = vi.fn().mockResolvedValue({
      factor: {
        id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
        type: 'totp',
        name: null,
        createdAt: EXPIRES,
        lastUsedAt: null,
      },
      recoveryCodes: null,
      loginCompleted: false,
    })
    await createAuthApi(api).enrolConfirm('a/b', '123456', 'correct horse battery')
    expect(api).toHaveBeenCalledWith('/v1/me/mfa/totp/a%2Fb/confirm', {
      method: 'POST',
      body: { code: '123456', password: 'correct horse battery' },
    })
  })

  it('refuses an answer that is not what the contract says, instead of passing it on', async () => {
    const api = vi.fn().mockResolvedValue({ status: 'something else' })
    await expect(createAuthApi(api).session()).rejects.toThrow()
    api.mockResolvedValue({ registrationOpen: 'yes' })
    await expect(createAuthApi(api).options()).rejects.toThrow()
  })

  it('lets an API error through for the screen to show', async () => {
    const api = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(createAuthApi(api).logout()).rejects.toThrow('boom')
  })
})

describe('toSessionView', () => {
  it('keeps what the screens need and leaves the CSRF token out (it is not for the HTML)', () => {
    const view = toSessionView({ status: 'authenticated', csrfToken: 'secret', account: ACCOUNT, expiresAt: EXPIRES })
    expect(view).toEqual({ status: 'authenticated', account: ACCOUNT, expiresAt: EXPIRES })
    expect(JSON.stringify(view)).not.toContain('secret')

    const half = toSessionView({ status: 'mfa_required', mfa: 'verification', csrfToken: 'secret', expiresAt: EXPIRES })
    expect(half).toEqual({ status: 'mfa_required', mfa: 'verification', expiresAt: EXPIRES })
    expect(toSessionView({ status: 'anonymous' })).toEqual({ status: 'anonymous' })
  })
})
