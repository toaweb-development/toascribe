import { OpenAPIHono } from '@hono/zod-openapi'
import {
  AcceptedResponse,
  ApiError,
  AuthOptionsResponse,
  ChoosePasswordRequest,
  LoginRequest,
  LoginResponse,
  LostPasswordRequest,
  MfaVerifyRequest,
  MfaVerifyResponse,
  RegisterRequest,
  SessionResponse,
  safeRedirectPath,
} from '@toascribe/shared'

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
  description: `Sets the session cookie. A wrong password, an unknown account and an account that is not active all answer the same 401. After a few failures the next try has to wait: 429 with Retry-After, the same for a name that exists and one that does not; the wait doubles with every further failure and ends by itself. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: LoginRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: LoginResponse } },
      description: 'Signed in, or the password was right and a second factor is still needed',
    },
    400: errorResponse('Invalid request, or a cross-site request'),
    401: errorResponse('Invalid username or password'),
    429: errorResponse('Too many failed attempts from this address or for this name: wait Retry-After seconds'),
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

const optionsRoute = defineRoute({
  method: 'get',
  path: '/auth/options',
  tags: ['auth'],
  summary: 'What the login screens need to know',
  description:
    'Public. Whether the register link is shown (the setting «Anyone can register») and the name of the site (the setting `blogname`, an empty string when it is not set).',
  policy: publicAccess(),
  responses: {
    200: { content: { 'application/json': { schema: AuthOptionsResponse } }, description: 'The options' },
  },
})

const verifyMfaRoute = defineRoute({
  method: 'post',
  path: '/auth/mfa/verify',
  tags: ['auth'],
  summary: 'Finish a login with a code from the authenticator app or a recovery code',
  description:
    'For a session in state `verification` (the answer of the login was `mfa_required`). Sets a new session cookie with the ' +
    'full lifetime; the CSRF token stays the same. A code of the same 30-second step works once, and a recovery code works once. ' +
    `A wrong code counts against the \`mfa\` limits (429 when they are used up). ${CSRF_NOTE} Needs the X-CSRF-Token header.`,
  policy: authenticated({ allowPendingMfa: true }),
  request: { body: { required: true, content: { 'application/json': { schema: MfaVerifyRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: MfaVerifyResponse } }, description: 'Signed in' },
    400: errorResponse('Invalid request'),
    401: errorResponse('No session, or it has expired (the half-signed-in session lives 10 minutes)'),
    403: errorResponse('CSRF token missing or wrong, or the code is wrong (`invalid_code`)'),
    409: errorResponse('The session has no second factor to pass (`mfa_not_pending`)'),
    429: errorResponse('Too many wrong codes; see Retry-After'),
  },
})

const lostPasswordRoute = defineRoute({
  method: 'post',
  path: '/auth/password/lost',
  tags: ['auth'],
  summary: 'Ask for a link to choose a new password',
  description:
    'A username or an e-mail address. Always 202 with the same body, and about the same time, whether or not the account ' +
    `exists (K-004); the mail is the only difference. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: LostPasswordRequest } } } },
  responses: {
    202: { content: { 'application/json': { schema: AcceptedResponse } }, description: 'Accepted' },
    400: errorResponse('Invalid request, or a cross-site request'),
    429: errorResponse('Too many requests from this address; see Retry-After'),
  },
})

const resetPasswordRoute = defineRoute({
  method: 'post',
  path: '/auth/password/reset',
  tags: ['auth'],
  summary: 'Choose a new password with the link from the lost-password mail',
  description:
    'The token is the one in the link (`...?action=resetpass#token=...`). It works once, for 24 hours, and only here: a link ' +
    'for another purpose is refused. Signs the account out everywhere. Does not sign in; the second factor, if any, is still ' +
    `asked at the next login. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: ChoosePasswordRequest } } } },
  responses: {
    204: { description: 'The password is changed' },
    400: errorResponse(
      'Invalid request, a password the site refuses (`weak_password`), or a link that is not valid (`invalid_token`)',
    ),
    429: errorResponse('Too many tries from this address; see Retry-After'),
  },
})

const setPasswordRoute = defineRoute({
  method: 'post',
  path: '/auth/password/set',
  tags: ['auth'],
  summary: 'Choose the first password with the link from the welcome mail',
  description:
    'The token is the one in the link (`...?action=setpassword#token=...`): the welcome mail of a registration or of an account ' +
    `an administrator made. It makes the account active. Same rules as /auth/password/reset. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: ChoosePasswordRequest } } } },
  responses: {
    204: { description: 'The password is set and the account is active' },
    400: errorResponse(
      'Invalid request, a password the site refuses (`weak_password`), or a link that is not valid (`invalid_token`)',
    ),
    429: errorResponse('Too many tries from this address; see Retry-After'),
  },
})

const registerRoute = defineRoute({
  method: 'post',
  path: '/auth/register',
  tags: ['auth'],
  summary: 'Register an account',
  description:
    'Only when the setting «Anyone can register» is on (403 `registration_closed` otherwise). Makes a pending account with the ' +
    'default role and mails a link to choose the password. 202 with the same body, and about the same time, whether or not the ' +
    'address was free (K-004): the owner of a taken address gets a mail about the attempt instead. A username that is taken is ' +
    `told, as WordPress does: 409 \`username_taken\`, whether or not the address is free. ${CSRF_NOTE}`,
  policy: publicAccess(),
  request: { body: { required: true, content: { 'application/json': { schema: RegisterRequest } } } },
  responses: {
    202: { content: { 'application/json': { schema: AcceptedResponse } }, description: 'Accepted' },
    400: errorResponse('Invalid request, or a cross-site request'),
    403: errorResponse('Registration is closed (`registration_closed`)'),
    409: errorResponse('The username is taken (`username_taken`); choose another'),
    429: errorResponse('Too many requests from this address; see Retry-After'),
    503: errorResponse('The default role cannot be given to visitors (`registration_unavailable`)'),
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
    .openapi(optionsRoute, async (c) => c.json(await services.flows.options({ ip: getClientIp(c) }), 200))
    .openapi(verifyMfaRoute, async (c) => {
      const auth = await requireSession(c)
      const verified = await services.mfa.verify(auth, c.req.valid('json'), {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
      })
      setSessionCookie(c, verified.issued.token, verified.issued.cookieMaxAgeSeconds)
      return c.json(
        {
          status: 'authenticated' as const,
          csrfToken: services.sessions.csrfToken(auth.session.id),
          account: toSessionAccount(auth),
          expiresAt: verified.issued.expiresAt.toISOString(),
          recoveryCodesRemaining: verified.recoveryCodesRemaining,
        },
        200,
      )
    })
    .openapi(lostPasswordRoute, async (c) => {
      await services.flows.requestPasswordReset(c.req.valid('json').login, {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
      })
      return c.json({ status: 'accepted' as const }, 202)
    })
    .openapi(resetPasswordRoute, async (c) => {
      const { token, password } = c.req.valid('json')
      await services.flows.resetPassword(token, password, { ip: getClientIp(c), requestId: c.get('requestId') })
      return c.body(null, 204)
    })
    .openapi(setPasswordRoute, async (c) => {
      const { token, password } = c.req.valid('json')
      await services.flows.setPassword(token, password, { ip: getClientIp(c), requestId: c.get('requestId') })
      return c.body(null, 204)
    })
    .openapi(registerRoute, async (c) => {
      await services.flows.register(c.req.valid('json'), { ip: getClientIp(c), requestId: c.get('requestId') })
      return c.json({ status: 'accepted' as const }, 202)
    })
    .openapi(logoutRoute, async (c) => {
      const auth = await requireSession(c)
      await services.auth.logout(auth, getClientIp(c), c.get('requestId'))
      clearSessionCookie(c)
      return c.body(null, 204)
    })
}
