import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, AssignRoleRequest, AssignRoleResponse, UserListQuery, UserListResponse } from '@toascribe/shared'

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
}
