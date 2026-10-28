import {
  AcceptedResponse,
  AuthOptionsResponse,
  EmailChangeConfirmResponse,
  LoginResponse,
  MfaConfirmResponse,
  MfaEnrolStartResponse,
  MfaVerifyResponse,
  SessionResponse,
} from '@toascribe/shared'
import type { MfaVerifyRequest } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** The versioned API: `apiBase` is `/api`, the account endpoints are under `/api/v1` (health is not). */
const V1 = '/v1'

/** What the login form sends (`LoginRequest` of the shared package, with `remember` always given). */
export interface LoginInput {
  login: string
  password: string
  remember: boolean
  /** A path on this site, as the address bar gave it. The API checks it again and answers with a safe one. */
  redirectTo?: string
}

/**
 * The endpoints of the sign-in screens (`/api/v1/auth/*`, `/api/v1/me/mfa/*`, `/api/v1/me/email-change/confirm`). Every
 * answer is parsed with the shared schema, so a wrong body is an error and not a lie. Errors are ApiRequestError.
 * The CSRF token is not handled here: the client does it (client.ts).
 */
export function createAuthApi(api: ApiCall) {
  return {
    /** Who is signed in. Always 200; the CSRF token comes with an authenticated or half-signed-in answer. */
    session: async () => SessionResponse.parse(await api(`${V1}/auth/session`)),
    /** What the login screens need before anyone is signed in. */
    options: async () => AuthOptionsResponse.parse(await api(`${V1}/auth/options`)),
    login: async (input: LoginInput) =>
      LoginResponse.parse(
        await api(`${V1}/auth/login`, {
          method: 'POST',
          body: {
            login: input.login,
            password: input.password,
            remember: input.remember,
            ...(input.redirectTo === undefined ? {} : { redirectTo: input.redirectTo }),
          },
        }),
      ),
    logout: async (): Promise<void> => {
      await api(`${V1}/auth/logout`, { method: 'POST' })
    },

    /** The second step of a login: a code from the app, or a recovery code. */
    verifyMfa: async (body: MfaVerifyRequest) =>
      MfaVerifyResponse.parse(await api(`${V1}/auth/mfa/verify`, { method: 'POST', body })),
    /** Starts enrolling an authenticator app: a secret, the otpauth address and the QR code as an SVG document. */
    enrolStart: async () => MfaEnrolStartResponse.parse(await api(`${V1}/me/mfa/totp`, { method: 'POST', body: {} })),
    /**
     * The last step of adding an authenticator app. In the half-signed-in session of a login that must enrol (state
     * `enrolment`) the password was given a moment ago and is not sent. In a complete session (adding a second factor from the
     * profile, M0.5) the API requires the current password: pass it, or the answer is 400 `password_required`.
     */
    enrolConfirm: async (id: string, code: string, password?: string) =>
      MfaConfirmResponse.parse(
        await api(`${V1}/me/mfa/totp/${encodeURIComponent(id)}/confirm`, {
          method: 'POST',
          body: password === undefined ? { code } : { code, password },
        }),
      ),

    /** Always accepted (202), whether or not the account exists. */
    lostPassword: async (login: string) =>
      AcceptedResponse.parse(await api(`${V1}/auth/password/lost`, { method: 'POST', body: { login } })),
    /** The link of «Mistet passordet?». */
    resetPassword: async (token: string, password: string): Promise<void> => {
      await api(`${V1}/auth/password/reset`, { method: 'POST', body: { token, password } })
    },
    /** The welcome link of a new or registered account. */
    setPassword: async (token: string, password: string): Promise<void> => {
      await api(`${V1}/auth/password/set`, { method: 'POST', body: { token, password } })
    },
    /** Always accepted (202), whether or not the name or the address was free. */
    /** `formToken` from `options()`, and the hidden field as the form had it (K-006). */
    register: async (username: string, email: string, formToken: string, website = '') =>
      AcceptedResponse.parse(
        await api(`${V1}/auth/register`, {
          method: 'POST',
          body: { username, email, formToken, ...(website === '' ? {} : { website }) },
        }),
      ),
    confirmEmail: async (token: string) =>
      EmailChangeConfirmResponse.parse(await api(`${V1}/me/email-change/confirm`, { method: 'POST', body: { token } })),
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useAuthApi(): AuthApi {
  const { $api } = useNuxtApp()
  return createAuthApi($api)
}
