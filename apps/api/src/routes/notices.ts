import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, NoticeKeyParams, NoticeListResponse } from '@toascribe/shared'

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

const listNoticesRoute = defineRoute({
  method: 'get',
  path: '/notices',
  tags: ['notices'],
  summary: 'The notices the account may see',
  description:
    'Stored notices that are not dismissed and whose capability the account holds, plus the notices the api works out from the ' +
    'system: `email.not_verified` (the site has not passed a test mail) and `proxy.not_trusted` (TOASCRIBE_TRUSTED_PROXY is ' +
    'empty and all requests come from one private address, `data.address`). Both are for accounts with manage_options and cannot ' +
    'be dismissed. `messageKey` is an admin i18n key, interpolated with `data`. Most severe first.',
  policy: requireCapability('read'),
  responses: {
    200: { content: { 'application/json': { schema: NoticeListResponse } }, description: 'The notices' },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks the read capability'),
  },
})

const dismissNoticeRoute = defineRoute({
  method: 'post',
  path: '/notices/{key}/dismiss',
  tags: ['notices'],
  summary: 'Dismiss a notice for everyone',
  description: `Only a stored, dismissible notice whose capability the account holds. Every other case is a 404, so a notice the account may not see is not revealed. Audit-logged. ${STATE_CHANGING_NOTE}`,
  policy: requireCapability('read'),
  request: { params: NoticeKeyParams },
  responses: {
    204: { description: 'Dismissed' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong'),
    404: errorResponse('No such notice, it cannot be dismissed, or the account may not see it'),
  },
})

/** Routes under /api/v1/notices. */
// The return type is spelled out so that `app.route(...)` in app.ts does not build one ever deeper type per router (TS2589).
export function createNoticesApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>()
    .openapi(listNoticesRoute, async (c) =>
      c.json({ notices: await services.notices.list(await requireSession(c)) }, 200),
    )
    .openapi(dismissNoticeRoute, async (c) => {
      const auth = await requireSession(c)
      const { key } = c.req.valid('param')
      await services.notices.dismiss(auth, key, { ip: getClientIp(c), requestId: c.get('requestId') })
      return c.body(null, 204)
    })
}
