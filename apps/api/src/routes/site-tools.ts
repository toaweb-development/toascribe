import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, SiteHealthInfoResponse, UpdateUpdatesSettingsRequest, UpdatesResponse } from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// «Oppdateringer» (M1.7, K-290), with `update_core`, and «Nettstedshelse → Info» (M1.7, K-203), with `manage_options`.

const errorResponse = (description: string) => ({ content: { 'application/json': { schema: ApiError } }, description })

const updatesRoute = defineRoute({
  method: 'get',
  path: '/updates',
  tags: ['system'],
  summary: 'The installed version and the newest release found',
  description:
    'What the last update check stored (the worker checks once a day; `toa check-update` at once). The api itself asks no registry. ' +
    'The containers are updated on the host, never from here.',
  policy: requireCapability('update_core'),
  responses: {
    200: { content: { 'application/json': { schema: UpdatesResponse } }, description: 'The versions' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No update_core'),
  },
})

const updateSettingsRoute = defineRoute({
  method: 'patch',
  path: '/updates/settings',
  tags: ['system'],
  summary: 'Turn the daily update check on or off',
  description:
    'The `update_check` setting. TOASCRIBE_UPDATE_CHECK=off on the server turns it off whatever this says. ' +
    'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body.',
  policy: requireCapability('update_core'),
  request: { body: { required: true, content: { 'application/json': { schema: UpdateUpdatesSettingsRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdatesResponse } },
      description: 'The versions, with the new setting',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no update_core'),
  },
})

const healthInfoRoute = defineRoute({
  method: 'get',
  path: '/site-health/info',
  tags: ['system'],
  summary: 'Nettstedshelse → Info',
  description:
    'Facts about the install in groups (toascribe, server, database, cache, worker, site, media, backup, updates), and the same as ' +
    'plain text for support with e-mail addresses, addresses, paths and anything that looks like a token replaced by [skjult]. ' +
    'No field holds a secret.',
  policy: requireCapability('manage_options'),
  responses: {
    200: { content: { 'application/json': { schema: SiteHealthInfoResponse } }, description: 'The facts' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No manage_options'),
  },
})

export function createSiteToolsApp(services: Services): OpenAPIHono<AppEnv> {
  const tools = services.siteTools
  return new OpenAPIHono<AppEnv>()
    .openapi(updatesRoute, async (c) => c.json(await tools.updates(await requireSession(c)), 200))
    .openapi(updateSettingsRoute, async (c) =>
      c.json(
        await tools.updateUpdates(await requireSession(c), c.req.valid('json'), {
          ip: getClientIp(c),
          requestId: c.get('requestId'),
        }),
        200,
      ),
    )
    .openapi(healthInfoRoute, async (c) => c.json(await tools.healthInfo(await requireSession(c)), 200))
}
