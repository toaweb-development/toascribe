import { OpenAPIHono } from '@hono/zod-openapi'
import { AdminMenuResponse, ApiError } from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const getMenuRoute = defineRoute({
  method: 'get',
  path: '/admin/menu',
  tags: ['admin'],
  summary: "The admin's left menu for the signed-in account",
  description:
    'Built from the menu registry (core and extensions) and filtered by what the account may do: an item shows when the account ' +
    'holds its capability, an item with sub-items shows only if one of them does, and an item marked «unless» is hidden from ' +
    'accounts that hold that capability. Sorted by WordPress position; equal positions in the order they were registered. ' +
    '`labelKey` is an admin i18n key and `icon` a Lucide name (`i-lucide-…`); `to` is a path inside the admin.',
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: AdminMenuResponse } }, description: 'The menu' },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks the read capability'),
  },
})

/** Routes under /api/v1/admin: what the admin shell itself needs. */
// The return type is spelled out so that `app.route(...)` in app.ts does not build one ever deeper type per router (TS2589).
export function createAdminApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>().openapi(getMenuRoute, async (c) => {
    const auth = await requireSession(c)
    return c.json({ items: services.adminMenu.forCapabilities(auth.capabilities) }, 200)
  })
}
