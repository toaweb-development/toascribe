import type { MfaPending, SessionAccount, SessionResponse } from '@toascribe/shared'

/**
 * What the app keeps of the session. It is in the Nuxt payload (the HTML), so it holds nothing secret: the CSRF token is
 * left out and lives in memory only (csrf.ts). `unknown` is before the first answer.
 */
export type SessionView =
  | { status: 'unknown' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; account: SessionAccount; expiresAt: string }
  | { status: 'mfa_required'; mfa: MfaPending; expiresAt: string }

export const UNKNOWN_SESSION: SessionView = { status: 'unknown' }

export const SESSION_STATE_KEY = 'auth:session'

/** The answer of `GET /auth/session`, the login or the second-factor call, without the CSRF token. */
export function toSessionView(answer: SessionResponse): SessionView {
  switch (answer.status) {
    case 'authenticated':
      return { status: 'authenticated', account: answer.account, expiresAt: answer.expiresAt }
    case 'mfa_required':
      return { status: 'mfa_required', mfa: answer.mfa, expiresAt: answer.expiresAt }
    case 'anonymous':
      return { status: 'anonymous' }
  }
}
