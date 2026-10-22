// The signed-in person's own security settings under /api/v1/me: second factor (K-023), password (K-013) and e-mail
// address (K-012). A route that finishes a half-done login (enrolment) is open to a half-signed-in session; the rest need a
// complete one.
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  ChangePasswordRequest,
  EmailChangeConfirmRequest,
  EmailChangeConfirmResponse,
  EmailChangeRequest,
  AcceptedResponse,
  MfaConfirmRequest,
  MfaConfirmResponse,
  MfaEnrolStartRequest,
  MfaEnrolStartResponse,
  MfaFactorIdParams,
  MfaListResponse,
  ReauthRequest,
  RecoveryCodesResponse,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import { setSessionCookie } from '../lib/cookies.ts'
import type { Context } from 'hono'

import type { AppEnv } from '../lib/env.ts'
import { authenticated, requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'
import type { RequestContext } from '../services/support.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body (if there is one).'

const context = (c: Context, requestId: string | undefined): RequestContext => ({ ip: getClientIp(c), requestId })

const listMfaRoute = defineRoute({
  method: 'get',
  path: '/me/mfa',
  tags: ['me'],
  summary: 'The second factors of the account',
  policy: requireCapability('read'),
  responses: {
    200: {
      content: { 'application/json': { schema: MfaListResponse } },
      description: 'Factors and recovery codes left',
    },
    401: errorResponse('Not signed in'),
  },
})

const startEnrolmentRoute = defineRoute({
  method: 'post',
  path: '/me/mfa/totp',
  tags: ['me'],
  summary: 'Start enrolling an authenticator app',
  description:
    'Makes a new secret (an earlier unfinished one is replaced) and returns it once, as text, as an otpauth:// address and as a ' +
    'QR code (SVG). It counts as a factor only after /me/mfa/totp/{id}/confirm. Also open to a half-signed-in session whose ' +
    `role requires a factor and that has none (state \`enrolment\`). The response is never cached. ${STATE_CHANGING_NOTE}`,
  policy: authenticated({ allowPendingMfa: true }),
  request: { body: { required: false, content: { 'application/json': { schema: MfaEnrolStartRequest } } } },
  responses: {
    201: { content: { 'application/json': { schema: MfaEnrolStartResponse } }, description: 'The secret, shown once' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in, or a second factor is required first'),
    403: errorResponse('CSRF token missing or wrong'),
    409: errorResponse('The account has as many authenticator apps as it can have (`too_many_factors`)'),
  },
})

const confirmEnrolmentRoute = defineRoute({
  method: 'post',
  path: '/me/mfa/totp/{id}/confirm',
  tags: ['me'],
  summary: 'Finish enrolling an authenticator app with its first code',
  description:
    'On the first factor of an account the ten recovery codes come back, once. In a half-signed-in session in state ' +
    '`enrolment` this also completes the login (a new session cookie is set; the CSRF token stays the same). ' +
    'In a complete session the body must also hold `password` (the current password): 400 `password_required` without it, ' +
    '403 `invalid_password` when it is wrong. A half-signed-in session in state `enrolment` does not send it (the password was ' +
    'given at the login). The owner gets a notice by e-mail before the factor is added. ' +
    `A wrong code counts against the \`mfa\` limits. ${STATE_CHANGING_NOTE}`,
  policy: authenticated({ allowPendingMfa: true }),
  request: {
    params: MfaFactorIdParams,
    body: { required: true, content: { 'application/json': { schema: MfaConfirmRequest } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: MfaConfirmResponse } }, description: 'Enrolled' },
    400: errorResponse('Invalid request, or no password in a complete session (`password_required`)'),
    401: errorResponse('Not signed in, or a second factor is required first'),
    403: errorResponse(
      'CSRF token missing or wrong, the password is wrong (`invalid_password`) or the code is wrong (`invalid_code`)',
    ),
    404: errorResponse('No such unfinished enrolment'),
    409: errorResponse('Already finished (`enrolment_finished`)'),
    429: errorResponse('Too many wrong passwords or codes; wait Retry-After seconds'),
  },
})

const removeFactorRoute = defineRoute({
  method: 'delete',
  path: '/me/mfa/{id}',
  tags: ['me'],
  summary: 'Remove a second factor',
  description:
    'The body proves it is the owner: `{ "password": "..." }`, the current password (a code from the app is not accepted). ' +
    'The owner gets a notice by e-mail before the factor is removed. The last factor of an account ' +
    `whose role requires one cannot be removed (409). Removing the last factor deletes the recovery codes. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: {
    params: MfaFactorIdParams,
    body: { required: true, content: { 'application/json': { schema: ReauthRequest } } },
  },
  responses: {
    204: { description: 'Removed' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or the password is wrong (`invalid_password`)'),
    404: errorResponse('The account has no such factor'),
    409: errorResponse('The last factor of an account whose role requires one (`mfa_required_by_role`)'),
    429: errorResponse('Too many wrong passwords; wait Retry-After seconds'),
  },
})

const regenerateRoute = defineRoute({
  method: 'post',
  path: '/me/mfa/recovery-codes',
  tags: ['me'],
  summary: 'Make new recovery codes',
  description:
    'Replaces all the recovery codes with ten new ones, returned once. The body proves it is the owner, as for removing a ' +
    `factor: \`{ "password": "..." }\`. The owner gets a notice by e-mail before the codes change. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: ReauthRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: RecoveryCodesResponse } },
      description: 'The new codes, shown once',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or the password is wrong (`invalid_password`)'),
    409: errorResponse('The account has no second factor (`no_factor`)'),
    429: errorResponse('Too many wrong passwords; wait Retry-After seconds'),
  },
})

const changePasswordRoute = defineRoute({
  method: 'patch',
  path: '/me/password',
  tags: ['me'],
  summary: 'Change the password',
  description: `Needs the current password. The owner gets a notice by e-mail before the change. Signs the account out of its other sessions and voids its pending links. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: ChangePasswordRequest } } } },
  responses: {
    204: { description: 'Changed' },
    400: errorResponse('Invalid request, or a password the site refuses (`weak_password`)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or the current password is wrong (`invalid_password`)'),
    429: errorResponse('Too many wrong passwords; see Retry-After'),
  },
})

const requestEmailChangeRoute = defineRoute({
  method: 'post',
  path: '/me/email-change',
  tags: ['me'],
  summary: 'Ask to change the e-mail address',
  description:
    'Needs the current password. Sends a link to the new address and a notice to the old one; nothing changes until the ' +
    'link is opened. Answers 202 whether or not the new address already has an account (its owner is told by mail). ' +
    STATE_CHANGING_NOTE,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: EmailChangeRequest } } } },
  responses: {
    202: { content: { 'application/json': { schema: AcceptedResponse } }, description: 'Accepted' },
    400: errorResponse('Invalid request, or the new address is the current one (`same_email`)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or the password is wrong (`invalid_password`)'),
    429: errorResponse('Too many wrong passwords; see Retry-After'),
  },
})

const confirmEmailChangeRoute = defineRoute({
  method: 'post',
  path: '/me/email-change/confirm',
  tags: ['me'],
  summary: 'Confirm the new e-mail address with the link from the mail',
  description: `The person must be signed in as the account the link was made for. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: EmailChangeConfirmRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: EmailChangeConfirmResponse } },
      description: 'The address is changed',
    },
    400: errorResponse('The link is not valid (`invalid_token`): unknown, expired, used, or for something else'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    409: errorResponse('The address can no longer be used (`email_unavailable`)'),
    429: errorResponse('Too many tries; see Retry-After'),
  },
})

/** Routes under /api/v1/me for the account's own security. */
export function createSecurityApp(services: Services) {
  return new OpenAPIHono<AppEnv>()
    .openapi(listMfaRoute, async (c) => c.json(await services.mfa.list(await requireSession(c)), 200))
    .openapi(startEnrolmentRoute, async (c) => {
      const auth = await requireSession(c)
      // A request without a body is valid, and then Hono has validated nothing: the value is `undefined` although its type says otherwise.
      const body: unknown = c.req.valid('json')
      const { name } = MfaEnrolStartRequest.parse(body ?? {})
      const started = await services.mfa.startEnrolment(auth, name, context(c, c.get('requestId')))
      // It holds the secret: no cache may keep it.
      c.header('Cache-Control', 'no-store')
      return c.json(started, 201)
    })
    .openapi(confirmEnrolmentRoute, async (c) => {
      const auth = await requireSession(c)
      const { id } = c.req.valid('param')
      const { code, password } = c.req.valid('json')
      const done = await services.mfa.confirmEnrolment(auth, id, code, password, context(c, c.get('requestId')))
      if (done.issued !== undefined) {
        setSessionCookie(c, done.issued.token, done.issued.cookieMaxAgeSeconds)
      }
      return c.json(
        { factor: done.factor, recoveryCodes: done.recoveryCodes, loginCompleted: done.issued !== undefined },
        200,
      )
    })
    .openapi(removeFactorRoute, async (c) => {
      const auth = await requireSession(c)
      const { id } = c.req.valid('param')
      await services.mfa.remove(auth, id, c.req.valid('json').password, context(c, c.get('requestId')))
      return c.body(null, 204)
    })
    .openapi(regenerateRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.mfa.regenerateRecoveryCodes(
        auth,
        c.req.valid('json').password,
        context(c, c.get('requestId')),
      )
      return c.json(result, 200)
    })
    .openapi(changePasswordRoute, async (c) => {
      const auth = await requireSession(c)
      const { currentPassword, newPassword } = c.req.valid('json')
      await services.ownAccount.changePassword(auth, currentPassword, newPassword, context(c, c.get('requestId')))
      return c.body(null, 204)
    })
    .openapi(requestEmailChangeRoute, async (c) => {
      const auth = await requireSession(c)
      const { newEmail, password } = c.req.valid('json')
      await services.ownAccount.requestEmailChange(auth, newEmail, password, context(c, c.get('requestId')))
      return c.json({ status: 'accepted' as const }, 202)
    })
    .openapi(confirmEmailChangeRoute, async (c) => {
      const auth = await requireSession(c)
      const { token } = c.req.valid('json')
      const email = await services.ownAccount.confirmEmailChange(auth, token, context(c, c.get('requestId')))
      return c.json({ email }, 200)
    })
}
