import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, LoginRequest, LoginResponse, SessionResponse, safeRedirectPath } from '@toascribe/shared'

import { clearSessionCookie, setSessionCookie } from '../lib/cookies.ts'
import type { AppEnv } from '../lib/env.ts'
import { getClientIp } from '../lib/client-ip.ts'
import { authenticated, publicAccess } from '../lib/policy.ts'
import { currentAuth, requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'
import { toSessionAccount } from '../services/me.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const CSRF_NOTE =
  'A cross-site request is refused: the Origin (or Sec-Fetch-Site) must be this site, and the body must be application/json.'

const loginRoute = defineRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Sign in with a username or e-mail address and a password',
  description: `Sets the session cookie. A wrong password, an unknown account and a locked account all answer the same 401. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: LoginRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: LoginResponse } },
      description: 'Signed in, or the password was right and a second factor is still needed',
    },
    400: errorResponse('Invalid request, or a cross-site request'),
    401: errorResponse('Invalid username or password'),
    429: errorResponse('Too many attempts from this address; see Retry-After'),
  },
})

const sessionRoute = defineRoute({
  method: 'get',
  path: '/auth/session',
  tags: ['auth'],
  summary: 'Who is signed in',
  description: 'Always 200. Anonymous callers get `{ "status": "anonymous" }`. Returns the CSRF token of the session.',
  policy: publicAccess(),
  responses: {
    200: { content: { 'application/json': { schema: SessionResponse } }, description: 'The state of the session' },
  },
})

const logoutRoute = defineRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'Sign out',
  description: `Ends the session and clears the cookie. Needs the X-CSRF-Token header. ${CSRF_NOTE}`,
  // A half-signed-in session (second factor still to do) can leave too.
  policy: authenticated({ allowPendingMfa: true }),
  responses: {
    204: { description: 'Signed out' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
  },
})

/** Routes under /api/v1/auth. */
export function createAuthApp(services: Services) {
  return new OpenAPIHono<AppEnv>()
    .openapi(loginRoute, async (c) => {
      const body = c.req.valid('json')
      const result = await services.auth.login({
        login: body.login,
        password: body.password,
        remember: body.remember,
        ip: getClientIp(c),
        userAgent: c.req.header('user-agent') ?? null,
        requestId: c.get('requestId'),
      })
      setSessionCookie(c, result.issued.token, result.issued.cookieMaxAgeSeconds)
      const csrfToken = services.sessions.csrfToken(result.issued.session.id)
      const expiresAt = result.issued.session.expiresAt.toISOString()
      const redirectTo = safeRedirectPath(body.redirectTo)
      if (result.mfa === 'ok') {
        return c.json(
          {
            status: 'authenticated' as const,
            csrfToken,
            account: {
              id: result.account.id,
              username: result.account.username,
              email: result.account.email,
              displayName: result.account.displayName,
              locale: result.account.locale,
              roles: [...result.roles],
              capabilities: [...result.capabilities],
            },
            expiresAt,
            redirectTo,
          },
          200,
        )
      }
      return c.json({ status: 'mfa_required' as const, mfa: result.mfa, csrfToken, expiresAt, redirectTo }, 200)
    })
    .openapi(sessionRoute, async (c) => {
      const auth = await currentAuth(c)
      if (auth.kind !== 'session') {
        return c.json({ status: 'anonymous' as const }, 200)
      }
      const csrfToken = services.sessions.csrfToken(auth.session.id)
      const expiresAt = auth.session.expiresAt.toISOString()
      if (auth.mfa === 'ok') {
        return c.json({ status: 'authenticated' as const, csrfToken, account: toSessionAccount(auth), expiresAt }, 200)
      }
      return c.json({ status: 'mfa_required' as const, mfa: auth.mfa, csrfToken, expiresAt }, 200)
    })
    .openapi(logoutRoute, async (c) => {
      const auth = await requireSession(c)
      await services.auth.logout(auth, getClientIp(c), c.get('requestId'))
      clearSessionCookie(c)
      return c.body(null, 204)
    })
}
