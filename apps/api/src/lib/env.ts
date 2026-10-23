import type { Logger } from 'pino'

import type { AuthContext } from './auth-context.ts'

/** The Hono environment: what middleware puts on the context. */
export interface AppEnv {
  Variables: {
    /** Set by hono/request-id. */
    requestId: string
    /** A child logger carrying the request id; set by the request-logger middleware. */
    logger: Logger
    /**
     * Looks up who is making the request, once per request (the result is kept). Lazy, so a route that is public and does
     * not ask never touches the database for a session. Use `currentAuth(c)`, not this.
     */
    resolveAuth: () => Promise<AuthContext>
    /** What the policy guard needs to check a state-changing request; set by the auth middleware. */
    security: RequestSecurity
  }
}

/** What the policy guard asks about the setup wizard's routes (see `SetupTokenPolicy`). Made by services/setup.ts. */
export interface SetupGate {
  /** Throws 404 when the site is installed: from then on a setup route does not exist, whatever the caller sends. */
  assertOpen: () => Promise<void>
  /**
   * Checks the setup token: 401 without one or with a wrong one, 429 when the address has guessed too often. `ip` is the
   * client address as `getClientIp` gives it.
   */
  authorize: (input: { readonly token: string | undefined; readonly ip: string }) => Promise<void>
}

export interface RequestSecurity {
  /** The origin visitors use (PUBLIC_ORIGIN), without a path. */
  readonly publicOrigin: string
  /** The CSRF token that belongs to a session id. */
  readonly csrfTokenFor: (sessionId: string) => string
  readonly setupGate: SetupGate
}
