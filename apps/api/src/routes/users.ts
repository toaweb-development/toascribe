import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import {
  ApiError,
  AssignRoleRequest,
  AssignRoleResponse,
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  SendPasswordResetRequest,
  SendPasswordResetResponse,
  UserDetail,
  UserListQuery,
  UserListResponse,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
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

const listUsersRoute = defineRoute({
  method: 'get',
  path: '/users',
  tags: ['users'],
  summary: 'The users table',
  description:
    "WordPress' users.php. `search` matches username, e-mail, display name and nicename anywhere in the text, without regard to " +
    'case. `role` is a role slug, or `none` for accounts without a role. `roleCounts` are the views above the table and ignore ' +
    '`search`, `role` and `page`. `roles` lists every role in WordPress order, with whether the signed-in account may give it. ' +
    '`postCount` is the published posts the account is an author of.',
  policy: requireCapability('list_users'),
  request: { query: UserListQuery },
  responses: {
    200: { content: { 'application/json': { schema: UserListResponse } }, description: 'One page of users' },
    400: errorResponse('Invalid query (an unknown parameter, order or a size out of range)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks the list_users capability'),
  },
})

const assignRoleRoute = defineRoute({
  method: 'put',
  path: '/users/roles',
  tags: ['users'],
  summary: 'Give accounts a role',
  description:
    "WordPress' «Endre rolle til…»: the roles of each account are replaced by this one. Accounts that cannot be changed are " +
    'named in `skipped` and the others are changed: `not_found` (no such account), `self` (never the signed-in account), ' +
    '`last_administrator` (the site keeps one active administrator) and `forbidden_user` (it holds a capability the signed-in ' +
    'account lacks). `unchanged` lists the accounts that already had exactly this role; nothing is written for them. All the ' +
    'changes are made in one transaction, each with an audit entry (`user.role_changed`); open sessions of a changed account ' +
    `use the new role at their next request. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('promote_users'),
  request: { body: { required: true, content: { 'application/json': { schema: AssignRoleRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: AssignRoleResponse } },
      description: 'What was changed and what was not',
    },
    400: errorResponse('Invalid request, or the role does not exist (code `unknown_role`)'),
    401: errorResponse('Not signed in'),
    403: errorResponse(
      'CSRF token missing or wrong, no promote_users capability, or a role the account may not give (code `forbidden_role`)',
    ),
  },
})

const UserParams = z.object({ id: z.uuid() })

const createUserRoute = defineRoute({
  method: 'post',
  path: '/users',
  tags: ['users'],
  summary: 'Add a user',
  description:
    "WordPress' «Legg til ny bruker». With `sendInvite` the account waits for its first password and gets a link (24 hours) by " +
    'mail; otherwise `password` is required and the account is active. The role must be one the signed-in account holds every ' +
    `capability of (\`forbidden_role\`). 409 \`username_taken\` or \`email_taken\`. Audited as \`user.created\`. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('create_users'),
  request: { body: { required: true, content: { 'application/json': { schema: CreateUserRequest } } } },
  responses: {
    201: { content: { 'application/json': { schema: CreateUserResponse } }, description: 'The new account' },
    400: errorResponse('Invalid request, an unknown role or a password the site refuses (`weak_password`)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, no create_users, or a role the account may not give'),
    409: errorResponse('The username or the e-mail address is taken'),
  },
})

const getUserRoute = defineRoute({
  method: 'get',
  path: '/users/{id}',
  tags: ['users'],
  summary: 'One user, for the delete screen',
  description: '`contentCount` counts everything the account is an author of, in any status.',
  policy: requireCapability('list_users'),
  request: { params: UserParams },
  responses: {
    200: { content: { 'application/json': { schema: UserDetail } }, description: 'The user' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No list_users'),
    404: errorResponse('No such user'),
  },
})

const deleteUserRoute = defineRoute({
  method: 'delete',
  path: '/users/{id}',
  tags: ['users'],
  summary: 'Delete a user',
  description:
    "WordPress' «Slett brukere»: the content goes to `reassignTo` (with the account's files), or with `reassignTo: null` the " +
    'content the account wrote alone is deleted for good and shared content keeps its other authors. Never the signed-in account ' +
    `(409 \`self\`) or the last active administrator (409 \`last_administrator\`). Audited as \`user.deleted\`. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('delete_users'),
  request: {
    params: UserParams,
    body: { required: true, content: { 'application/json': { schema: DeleteUserRequest } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteUserResponse } },
      description: 'What happened to the content',
    },
    400: errorResponse('Invalid request, or no such user to give the content to (`reassign_invalid`)'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, no delete_users, or a user with more rights (`forbidden_user`)'),
    404: errorResponse('No such user'),
    409: errorResponse('The signed-in account, or the last administrator'),
  },
})

const sendResetRoute = defineRoute({
  method: 'post',
  path: '/users/password-reset',
  tags: ['users'],
  summary: 'Send password reset links',
  description:
    "WordPress' bulk action «Send tilbakestilling av passord»: each account gets a link (24 hours) by mail, or its welcome link " +
    `when it never chose a password. Disabled accounts and accounts with more rights are skipped. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('edit_users'),
  request: { body: { required: true, content: { 'application/json': { schema: SendPasswordResetRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: SendPasswordResetResponse } }, description: 'How many were sent' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no edit_users'),
  },
})

/** Routes under /api/v1/users. */
// The return type is spelled out so that `app.route(...)` in app.ts does not build one ever deeper type per router (TS2589).
export function createUsersApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>()
    .openapi(listUsersRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.users.list(auth, c.req.valid('query'))
      c.header('X-Total-Count', String(result.total))
      c.header('X-Total-Pages', String(Math.ceil(result.total / result.perPage)))
      return c.json(result, 200)
    })
    .openapi(assignRoleRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.users.assignRole(auth, c.req.valid('json'), {
        ip: getClientIp(c),
        requestId: c.get('requestId'),
      })
      return c.json(result, 200)
    })
    .openapi(createUserRoute, async (c) => {
      const auth = await requireSession(c)
      const created = await services.users.create(auth, c.req.valid('json'), context(c))
      return c.json(created, 201)
    })
    .openapi(sendResetRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.users.sendPasswordResets(auth, c.req.valid('json'), context(c)), 200)
    })
    .openapi(getUserRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.users.get(auth, c.req.valid('param').id), 200)
    })
    .openapi(deleteUserRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.users.remove(auth, c.req.valid('param').id, c.req.valid('json'), context(c))
      return c.json(result, 200)
    })
}

function context(c: Parameters<typeof getClientIp>[0]) {
  return { ip: getClientIp(c), requestId: c.get('requestId') }
}
