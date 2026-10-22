import { OpenAPIHono } from '@hono/zod-openapi'
import { ApiError, TestEmailRequest, TestEmailResponse } from '@toascribe/shared'

import { getClientIp, UNKNOWN_IP } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const sendTestEmailRoute = defineRoute({
  method: 'post',
  path: '/system/test-email',
  tags: ['system'],
  summary: 'Send a test e-mail',
  description:
    "Queues a test mail to the given address, or to the signed-in account's own. It proves that the SMTP settings work. " +
    'At most one per account per 30 seconds. The mail is sent by the worker, so 202 means queued, not delivered. ' +
    'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body.',
  policy: requireCapability('manage_options'),
  request: { body: { required: false, content: { 'application/json': { schema: TestEmailRequest } } } },
  responses: {
    202: { content: { 'application/json': { schema: TestEmailResponse } }, description: 'Queued' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_options capability'),
    429: errorResponse('A test mail was sent a moment ago (Retry-After says how long to wait)'),
  },
})

/** Routes under /api/v1/system. */
export function createSystemApp(services: Services) {
  return new OpenAPIHono<AppEnv>().openapi(sendTestEmailRoute, async (c) => {
    const auth = await requireSession(c)
    // A request without a body is valid, and then Hono has validated nothing: the value is `undefined` although its type says otherwise.
    const body: unknown = c.req.valid('json')
    const { to } = TestEmailRequest.parse(body ?? {})
    const ip = getClientIp(c)
    const sent = await services.system.sendTestEmail(auth, to, {
      ip: ip === UNKNOWN_IP ? null : ip,
      requestId: c.get('requestId'),
    })
    return c.json(sent, 202)
  })
}
