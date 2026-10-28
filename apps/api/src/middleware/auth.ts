import type { Context, MiddlewareHandler } from 'hono'

import { ANONYMOUS } from '../lib/auth-context.ts'
import type { AuthContext, SessionAuth } from '../lib/auth-context.ts'
import { clearSessionCookie, readSessionCookie } from '../lib/cookies.ts'
import type { AppEnv, SetupGate } from '../lib/env.ts'
import { UnauthorizedError } from '../lib/errors.ts'
import { getClientIp } from '../lib/client-ip.ts'
import type { AppPasswordService } from '../services/app-passwords.ts'
import { InsecureTransportError, hasBasicHeader, parseBasic, takesAppPassword } from '../services/app-passwords.ts'
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
  readonly appPasswords: AppPasswordService
  readonly publicOrigin: string
  readonly setupGate: SetupGate
}): MiddlewareHandler<AppEnv> {
  const { sessions, appPasswords, publicOrigin, setupGate } = options
  return async (c, next) => {
    c.set('security', { publicOrigin, csrfTokenFor: (sessionId) => sessions.csrfToken(sessionId), setupGate })
    let pending: Promise<AuthContext> | undefined
    c.set('resolveAuth', () => {
      pending ??= (async () => {
        // An application password (K-016), on the routes that take one: it decides alone, the cookie is not looked at.
        const authorization = c.req.header('authorization')
        if (usesAppPassword(c)) {
          if (c.req.header('x-forwarded-proto') !== 'https') throw new InsecureTransportError()
          return appPasswords.authenticate(
            parseBasic(authorization) ?? { login: '', password: '' },
            { ip: getClientIp(c) },
            c.get('logger'),
          )
        }
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

/** Whether this request signs in with an application password: a Basic header on a route that takes one. */
export function usesAppPassword(c: Context<AppEnv>): boolean {
  return hasBasicHeader(c.req.header('authorization')) && takesAppPassword(c.req.path)
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
