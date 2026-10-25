import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, GlanceResponse } from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const glanceRoute = defineRoute({
  method: 'get',
  path: '/dashboard/glance',
  tags: ['dashboard'],
  summary: 'The dashboard «At a Glance» counts',
  description:
    'Published posts (needs edit_posts), published pages (needs edit_pages) and comments, approved and pending (needs ' +
    'moderate_comments), as WordPress shows them. A count the account may not see is left out, not 0. `version` is the api version.',
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: GlanceResponse } }, description: 'The counts' },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks the read capability'),
  },
})

/** Routes under /api/v1/dashboard. */
// The return type is spelled out so that `app.route(...)` in app.ts does not build one ever deeper type per router (TS2589).
export function createDashboardApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>().openapi(glanceRoute, async (c) =>
    c.json(await services.dashboard.glance(await requireSession(c)), 200),
  )
}
