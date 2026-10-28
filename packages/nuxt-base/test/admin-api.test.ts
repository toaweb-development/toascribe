import { DEFAULT_PREFERENCES } from '@toascribe/shared'
import { describe, expect, it, vi } from 'vitest'

import { createAdminApi } from '../app/lib/api/admin.ts'
import { createMeApi } from '../app/lib/api/me.ts'

const PREFERENCES = DEFAULT_PREFERENCES

describe('the admin shell API layer', () => {
  it('asks the menu, the glance and the notices, and parses what comes back', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 'dashboard',
            labelKey: 'menu.dashboard',
            icon: 'i-lucide-gauge',
            position: 2,
            to: '/',
            children: [{ id: 'dashboard.home', labelKey: 'menu.dashboardHome', to: '/' }],
          },
        ],
      })
      .mockResolvedValueOnce({ posts: 1, comments: { approved: 1, pending: 0 }, version: '0.5.0' })
      .mockResolvedValueOnce({
        notices: [
          {
            key: 'email.not_verified',
            level: 'warning',
            messageKey: 'notices.emailNotVerified',
            data: {},
            isDismissible: false,
          },
        ],
      })
    const admin = createAdminApi(api)

    expect((await admin.menu()).items[0]?.children).toHaveLength(1)
    expect(await admin.glance()).toEqual({ posts: 1, comments: { approved: 1, pending: 0 }, version: '0.5.0' })
    expect((await admin.notices()).notices[0]?.key).toBe('email.not_verified')
    expect(api).toHaveBeenNthCalledWith(1, '/v1/admin/menu')
    expect(api).toHaveBeenNthCalledWith(2, '/v1/dashboard/glance')
    expect(api).toHaveBeenNthCalledWith(3, '/v1/notices')
  })

  it('refuses a menu that is not the shared shape', async () => {
    const admin = createAdminApi(vi.fn().mockResolvedValue({ items: [{ id: 'x' }] }))
    await expect(admin.menu()).rejects.toThrow()
  })

  it('leaves a count out of the glance when the API does', async () => {
    const admin = createAdminApi(vi.fn().mockResolvedValue({ version: '0.5.0' }))
    expect(await admin.glance()).toEqual({ version: '0.5.0' })
  })

  it('dismisses a notice with a POST and no body, the key encoded', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    await createAdminApi(api).dismissNotice('setup.email_skipped')
    await createAdminApi(api).dismissNotice('a/b')
    expect(api).toHaveBeenNthCalledWith(1, '/v1/notices/setup.email_skipped/dismiss', { method: 'POST' })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/notices/a%2Fb/dismiss', { method: 'POST' })
  })
})

describe('the own-account API layer', () => {
  const ME = {
    id: '01a15f9a-26a2-73d3-8aad-c6b671836b33',
    username: 'alice',
    email: 'alice@example.test',
    displayName: 'alice',
    locale: null,
    roles: ['editor'],
    capabilities: ['read'],
    profile: {
      firstName: '',
      lastName: '',
      nickname: '',
      displayNameChoice: 'username',
      website: '',
      bio: '',
      avatarId: null,
    },
    preferences: PREFERENCES,
    pendingEmail: null,
    avatarUrl: null,
  }

  it('reads the account with its preferences', async () => {
    const api = vi.fn().mockResolvedValue(ME)
    const me = await createMeApi(api).get()
    expect(me.preferences.adminColorScheme).toBe('default')
    expect(api).toHaveBeenCalledWith('/v1/me')
  })

  it('patches only the preferences it is given and returns all of them', async () => {
    const api = vi.fn().mockResolvedValue({ ...PREFERENCES, dismissedWelcome: true })
    const answer = await createMeApi(api).updatePreferences({ dismissedWelcome: true })
    expect(api).toHaveBeenCalledWith('/v1/me/preferences', { method: 'PATCH', body: { dismissedWelcome: true } })
    expect(answer.dismissedWelcome).toBe(true)
  })
  const FACTOR = {
    id: '01a15f9a-26a2-73d3-8aad-c6b671836b44',
    type: 'totp',
    name: 'iPhone',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastUsedAt: null,
  }
  const SESSION = {
    id: '01a15f9a-26a2-73d3-8aad-c6b671836b55',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastSeenAt: '2026-10-01T10:05:00.000Z',
    expiresAt: '2026-10-02T10:00:00.000Z',
    ip: '203.0.113.7',
    userAgent: null,
    isRemembered: false,
    isCurrent: true,
  }

  it('saves the profile fields with a PATCH and parses the whole account', async () => {
    const api = vi.fn().mockResolvedValue(ME)
    const answer = await createMeApi(api).updateProfile({ firstName: 'Alice', displayNameChoice: 'first_name' })
    expect(api).toHaveBeenCalledWith('/v1/me', {
      method: 'PATCH',
      body: { firstName: 'Alice', displayNameChoice: 'first_name' },
    })
    expect(answer.username).toBe('alice')
  })

  it('sends the current password with every call that proves the owner', async () => {
    const api = vi.fn().mockResolvedValue(undefined)
    const me = createMeApi(api)
    await me.changePassword('old pass word', 'new pass word')
    await me.removeFactor('a/b', 'pw')
    expect(api).toHaveBeenNthCalledWith(1, '/v1/me/password', {
      method: 'PATCH',
      body: { currentPassword: 'old pass word', newPassword: 'new pass word' },
    })
    expect(api).toHaveBeenNthCalledWith(2, '/v1/me/mfa/a%2Fb', { method: 'DELETE', body: { password: 'pw' } })

    api.mockResolvedValueOnce({ status: 'accepted' })
    await me.requestEmailChange('new@example.test', 'pw')
    expect(api).toHaveBeenLastCalledWith('/v1/me/email-change', {
      method: 'POST',
      body: { newEmail: 'new@example.test', password: 'pw' },
    })

    api.mockResolvedValueOnce({ recoveryCodes: ['ABCD-EFGH-JKMN-PQRS'] })
    expect((await me.newRecoveryCodes('pw')).recoveryCodes).toHaveLength(1)
    expect(api).toHaveBeenLastCalledWith('/v1/me/mfa/recovery-codes', { method: 'POST', body: { password: 'pw' } })
  })

  it('reads the second factors and the sessions, and ends sessions', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ factors: [FACTOR], recoveryCodesRemaining: 10, required: true })
      .mockResolvedValueOnce({ sessions: [SESSION] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ revoked: 2 })
    const me = createMeApi(api)
    expect((await me.mfa()).required).toBe(true)
    expect((await me.sessions()).sessions[0]?.isCurrent).toBe(true)
    await me.endSession('x')
    expect((await me.endOtherSessions()).revoked).toBe(2)
    expect(api).toHaveBeenNthCalledWith(3, '/v1/me/sessions/x', { method: 'DELETE' })
    expect(api).toHaveBeenNthCalledWith(4, '/v1/me/sessions', { method: 'DELETE' })
  })

  it('refuses a session list that is not the shared shape', async () => {
    const me = createMeApi(vi.fn().mockResolvedValue({ sessions: [{ id: 'x' }] }))
    await expect(me.sessions()).rejects.toThrow()
  })
})
