import {
  AcceptedResponse,
  MeResponse,
  MfaListResponse,
  Preferences,
  RecoveryCodesResponse,
  RevokeSessionsResponse,
  SessionListResponse,
} from '@toascribe/shared'
import type { UpdateMeRequest, UpdatePreferencesRequest } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** The versioned API: `apiBase` is `/api`, the account endpoints are under `/api/v1`. */
const V1 = '/v1'

/**
 * The signed-in account's own data (`/api/v1/me`): the profile, the preferences, and the account's own security (password,
 * e-mail address, second factors, sessions). The shell reads the preferences (colour scheme, the welcome panel) from here; the
 * profile page (M0.5) uses all of it. Every call that proves the owner takes the current password in its body: there is no
 * «recently signed in» window, so a wrong password is a 403 `invalid_password` and the call can simply be repeated.
 */
export function createMeApi(api: ApiCall) {
  return {
    /** The account with its profile fields and preferences. */
    get: async () => MeResponse.parse(await api(`${V1}/me`)),
    /** Changes some of the preferences; the answer is all of them. At least one key must be given. */
    updatePreferences: async (changes: UpdatePreferencesRequest) =>
      Preferences.parse(await api(`${V1}/me/preferences`, { method: 'PATCH', body: changes })),
    /** Changes some profile fields (not the e-mail address); the answer is the whole account. */
    updateProfile: async (changes: UpdateMeRequest) =>
      MeResponse.parse(await api(`${V1}/me`, { method: 'PATCH', body: changes })),

    /** Asks for a new e-mail address: a link goes to it, and nothing changes until the link is opened. Always 202. */
    requestEmailChange: async (newEmail: string, password: string) =>
      AcceptedResponse.parse(await api(`${V1}/me/email-change`, { method: 'POST', body: { newEmail, password } })),
    /** Needs the current password; the account's other sessions end. 400 `weak_password` when the site refuses the new one. */
    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
      await api(`${V1}/me/password`, { method: 'PATCH', body: { currentPassword, newPassword } })
    },

    /** The second factors, how many recovery codes are left, and whether the account's role requires a factor. */
    mfa: async () => MfaListResponse.parse(await api(`${V1}/me/mfa`)),
    /** Needs the current password. 409 `mfa_required_by_role` for the last factor of an account whose role requires one. */
    removeFactor: async (id: string, password: string): Promise<void> => {
      await api(`${V1}/me/mfa/${encodeURIComponent(id)}`, { method: 'DELETE', body: { password } })
    },
    /** Needs the current password. Ten new codes, shown once; the old ones stop working. */
    newRecoveryCodes: async (password: string) =>
      RecoveryCodesResponse.parse(await api(`${V1}/me/mfa/recovery-codes`, { method: 'POST', body: { password } })),

    /** The active sessions, newest first; `isCurrent` marks the one making the request. */
    sessions: async () => SessionListResponse.parse(await api(`${V1}/me/sessions`)),
    /** Ends one session. Ending the current one signs this browser out. */
    endSession: async (id: string): Promise<void> => {
      await api(`${V1}/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    /** «Logg ut overalt ellers»: ends all sessions except this one, and says how many. */
    endOtherSessions: async () => RevokeSessionsResponse.parse(await api(`${V1}/me/sessions`, { method: 'DELETE' })),
  }
}

export type MeApi = ReturnType<typeof createMeApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useMeApi(): MeApi {
  const { $api } = useNuxtApp()
  return createMeApi($api)
}
