import type { Context, MiddlewareHandler } from 'hono'

import { ANONYMOUS } from '../lib/auth-context.ts'
import type { AuthContext, SessionAuth } from '../lib/auth-context.ts'
import { clearSessionCookie, readSessionCookie } from '../lib/cookies.ts'
import type { AppEnv } from '../lib/env.ts'
import { UnauthorizedError } from '../lib/errors.ts'
import type { SessionService } from '../services/sessions.ts'

/**
 * Prepares the context for the guard and the handlers (K-312): the origin and the CSRF function, and a lookup of who is
 * asking that runs at most once per request and only if something asks. It does not decide anything itself.
 *
 * A cookie that names no live session (expired, ended elsewhere, account disabled) is cleared in the response, so the
 * browser stops sending it.
 */
export function authContext(options: {
  readonly sessions: SessionService
  readonly publicOrigin: string
}): MiddlewareHandler<AppEnv> {
  const { sessions, publicOrigin } = options
  return async (c, next) => {
    c.set('security', { publicOrigin, csrfTokenFor: (sessionId) => sessions.csrfToken(sessionId) })
    let pending: Promise<AuthContext> | undefined
    c.set('resolveAuth', () => {
      pending ??= (async () => {
        const token = readSessionCookie(c)
        if (token === undefined) {
          return ANONYMOUS
        }
        const auth = await sessions.authenticate(token, c.get('logger'))
        if (auth.kind === 'anonymous') {
          clearSessionCookie(c)
        }
        return auth
      })()
      return pending
    })
    await next()
  }
}

/** Who is making this request. A session is looked up on the first call and remembered for the rest of the request. */
export function currentAuth(c: Context<AppEnv>): Promise<AuthContext> {
  return c.get('resolveAuth')()
}

/** The signed-in session, or a 401. After the policy guard it is always there; this keeps the handler's types honest and fails closed. */
export async function requireSession(c: Context<AppEnv>): Promise<SessionAuth> {
  const auth = await currentAuth(c)
  if (auth.kind !== 'session') {
    throw new UnauthorizedError()
  }
  return auth
}
