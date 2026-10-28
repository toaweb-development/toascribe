import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  AppPasswordListResponse,
  CreateAppPasswordRequest,
  CreateAppPasswordResponse,
  MeResponse,
  RevokeSessionsResponse,
  SessionIdParams,
  Preferences,
  SessionListResponse,
  UpdateMeRequest,
  UpdatePreferencesRequest,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import { clearSessionCookie } from '../lib/cookies.ts'
import type { AppEnv } from '../lib/env.ts'
import { NotFoundError } from '../lib/errors.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body (if there is one).'

// «Meg» needs `read` (PLAN, endpoint map): every built-in role has it, and an administrator can take it from a custom role.
const getMeRoute = defineRoute({
  method: 'get',
  path: '/me',
  tags: ['me'],
  summary: 'The signed-in account and its profile',
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: MeResponse } }, description: 'The account' },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks the read capability'),
  },
})

const patchMeRoute = defineRoute({
  method: 'patch',
  path: '/me',
  tags: ['me'],
  summary: 'Change the profile',
  description: `First and last name, nickname, public display name, website and biography. The e-mail address is not changed here (it needs a confirmation link). ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: UpdateMeRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: MeResponse } }, description: 'The account after the change' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no read capability'),
  },
})

const patchPreferencesRoute = defineRoute({
  method: 'patch',
  path: '/me/preferences',
  tags: ['me'],
  summary: 'Change the preferences',
  description: `Admin colour scheme, the toolbar on the site and the dismissed welcome panel. Send any of them; the others keep their value, and so do keys a later version adds. Returns all the preferences. No password is needed. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: UpdatePreferencesRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: Preferences } }, description: 'The preferences after the change' },
    400: errorResponse('Invalid request (an unknown preference or scheme, or nothing to change)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no read capability'),
  },
})

const listSessionsRoute = defineRoute({
  method: 'get',
  path: '/me/sessions',
  tags: ['me'],
  summary: "The account's active sessions",
  policy: requireCapability('read'),
  responses: {
    200: {
      content: { 'application/json': { schema: SessionListResponse } },
      description: 'Active sessions, newest first',
    },
    401: errorResponse('Not signed in'),
  },
})

const revokeSessionRoute = defineRoute({
  method: 'delete',
  path: '/me/sessions/{id}',
  tags: ['me'],
  summary: "End one of the account's own sessions",
  description: `Ending the current session signs this browser out. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { params: SessionIdParams },
  responses: {
    204: { description: 'Ended' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    404: errorResponse('The account has no such session'),
  },
})

const revokeOtherSessionsRoute = defineRoute({
  method: 'delete',
  path: '/me/sessions',
  tags: ['me'],
  summary: 'Sign out everywhere else',
  description: `Ends all the account's sessions except the one making the request. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: RevokeSessionsResponse } }, description: 'How many were ended' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
  },
})

/** Routes under /api/v1/me. */
// Application passwords (K-016): only from the admin with the session cookie; a client holding one cannot list, make or revoke
// them (the /me routes never take an application password).
const listAppPasswordsRoute = defineRoute({
  method: 'get',
  path: '/me/app-passwords',
  tags: ['me'],
  summary: "The account's application passwords",
  description: 'Name, when made, and when and from where last used. Never the password.',
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: AppPasswordListResponse } }, description: 'The list' },
    401: errorResponse('Not signed in'),
  },
})

const createAppPasswordRoute = defineRoute({
  method: 'post',
  path: '/me/app-passwords',
  tags: ['me'],
  summary: 'Make an application password',
  description:
    'The answer holds the password, once: only its hash is kept. It signs in to the API with `Authorization: Basic` over HTTPS, ' +
    `never to the admin. 409 \`name_taken\` or \`too_many\`. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { body: { required: true, content: { 'application/json': { schema: CreateAppPasswordRequest } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: CreateAppPasswordResponse } },
      description: 'Made; the password is shown once',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    409: errorResponse('The name is taken, or the account has the most it may have'),
  },
})

const revokeAppPasswordRoute = defineRoute({
  method: 'delete',
  path: '/me/app-passwords/{id}',
  tags: ['me'],
  summary: 'Revoke an application password',
  description: `It stops working at once. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { params: SessionIdParams },
  responses: {
    204: { description: 'Revoked' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    404: errorResponse('The account has no such application password'),
  },
})

export function createMeApp(services: Services) {
  return new OpenAPIHono<AppEnv>()
    .openapi(getMeRoute, async (c) => c.json(await services.me.get(await requireSession(c)), 200))
    .openapi(patchMeRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.me.update(auth, c.req.valid('json')), 200)
    })
    .openapi(patchPreferencesRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.me.updatePreferences(auth, c.req.valid('json')), 200)
    })
    .openapi(listSessionsRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json({ sessions: await services.sessions.list(auth) }, 200)
    })
    .openapi(revokeSessionRoute, async (c) => {
      const auth = await requireSession(c)
      const { id } = c.req.valid('param')
      // Someone else's session and a session that does not exist both answer 404 (security §2).
      const ended = await services.auth.revokeSession(auth, id, getClientIp(c), c.get('requestId'))
      if (!ended) {
        throw new NotFoundError('No such session')
      }
      if (id === auth.session.id) {
        clearSessionCookie(c)
      }
      return c.body(null, 204)
    })
    .openapi(revokeOtherSessionsRoute, async (c) => {
      const auth = await requireSession(c)
      const revoked = await services.auth.revokeOtherSessions(auth, getClientIp(c), c.get('requestId'))
      return c.json({ revoked }, 200)
    })
    .openapi(listAppPasswordsRoute, async (c) => c.json(await services.appPasswords.list(await requireSession(c)), 200))
    .openapi(createAppPasswordRoute, async (c) => {
      const auth = await requireSession(c)
      const made = await services.appPasswords.create(auth, c.req.valid('json'), {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
      })
      return c.json(made, 201)
    })
    .openapi(revokeAppPasswordRoute, async (c) => {
      const auth = await requireSession(c)
      await services.appPasswords.revoke(auth, c.req.valid('param').id, {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
      })
      return c.body(null, 204)
    })
}
