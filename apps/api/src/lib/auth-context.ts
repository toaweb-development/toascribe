import type { AccountView } from '../repositories/accounts.ts'
import type { SessionRecord } from '../repositories/sessions.ts'

/**
 * Where the second-factor step stands for a session (K-023).
 * - `ok`: no second factor is needed, or it has been passed in this session.
 * - `verification`: the account has a factor, and this session has not used it yet.
 * - `enrolment`: a role of the account requires a factor, the account has none, and this session has not set one up yet.
 * A session that is not `ok` may only finish that step (and log out); every other route turns it away.
 */
export type MfaStatus = 'ok' | 'verification' | 'enrolment'

export interface AnonymousAuth {
  readonly kind: 'anonymous'
}

/** What the middleware puts on the context for a request with a live session (K-312). */
export interface SessionAuth {
  readonly kind: 'session'
  readonly account: AccountView
  /** Role slugs. */
  readonly roles: readonly string[]
  /** The union of the capabilities of all the roles. */
  readonly capabilities: ReadonlySet<string>
  readonly session: SessionRecord
  readonly mfa: MfaStatus
  /**
   * How the request proved who it is. `cookie`: every state-changing call needs the CSRF token. `app_password` (phase 1,
   * `Authorization` header): the browser does not send it by itself, so there is nothing to forge and no token is needed.
   */
  readonly via: 'cookie' | 'app_password'
}

export type AuthContext = AnonymousAuth | SessionAuth

export const ANONYMOUS: AnonymousAuth = { kind: 'anonymous' }
