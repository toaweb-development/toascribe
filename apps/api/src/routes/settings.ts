import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  ConfirmAdminEmailRequest,
  ConfirmAdminEmailResponse,
  GeneralSettingsResponse,
  PrivacySettingsResponse,
  ReadingSettingsResponse,
  UpdateGeneralSettingsRequest,
  UpdatePrivacySettingsRequest,
  UpdateReadingSettingsRequest,
  UpdateWritingSettingsRequest,
  WritingSettingsResponse,
} from '@toascribe/shared'
import type { z } from '@hono/zod-openapi'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// The settings screens of M1.5 (K-191 to K-194, K-198): «Generelt», «Skriving», «Lesing» and «Personvern», `manage_options`. Media's
// screen is in routes/media.ts. A change clears the site's cache (the audit entry's `settings` object).

const errorResponse = (description: string) => ({ content: { 'application/json': { schema: ApiError } }, description })
const MANAGE = requireCapability('manage_options')
const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body.'

function pair<R extends z.ZodType, Q extends z.ZodType>(
  group: string,
  title: string,
  description: string,
  response: R,
  request: Q,
) {
  const get = defineRoute({
    method: 'get',
    path: `/settings/${group}`,
    tags: ['settings'],
    summary: `Settings → ${title}`,
    description,
    policy: MANAGE,
    responses: {
      200: { content: { 'application/json': { schema: response } }, description: 'The settings' },
      401: errorResponse('Not signed in'),
      403: errorResponse('No manage_options'),
    },
  })
  const patch = defineRoute({
    method: 'patch',
    path: `/settings/${group}`,
    tags: ['settings'],
    summary: `Change Settings → ${title}`,
    description: `Only the fields sent change. \`invalid_setting\` names a field a value does not fit. ${STATE_CHANGING_NOTE}`,
    policy: MANAGE,
    request: { body: { required: true, content: { 'application/json': { schema: request } } } },
    responses: {
      200: { content: { 'application/json': { schema: response } }, description: 'The settings afterwards' },
      400: errorResponse('Invalid request, or `invalid_setting`'),
      401: errorResponse('Not signed in'),
      403: errorResponse('CSRF token missing or wrong, or no manage_options'),
    },
  })
  return { get, patch }
}

const general = pair(
  'general',
  'General',
  'Title, tagline, the administrator address (and one waiting for its confirmation), membership, the default role, language, ' +
    'time zone, date and time formats and the first day of the week. `siteUrl` is PUBLIC_ORIGIN and only shown.',
  GeneralSettingsResponse,
  UpdateGeneralSettingsRequest,
)
const writing = pair(
  'writing',
  'Writing',
  'The default category and post format.',
  WritingSettingsResponse,
  UpdateWritingSettingsRequest,
)
const reading = pair(
  'reading',
  'Reading',
  'What the front page shows (K-226), posts per page, the feed (M1.6) and search engine visibility.',
  ReadingSettingsResponse,
  UpdateReadingSettingsRequest,
)
const privacy = pair(
  'privacy',
  'Privacy',
  'The privacy policy page (K-198).',
  PrivacySettingsResponse,
  UpdatePrivacySettingsRequest,
)

const confirmRoute = defineRoute({
  method: 'post',
  path: '/settings/general/admin-email/confirm',
  tags: ['settings'],
  summary: 'Confirm a new administrator address',
  description:
    'The token of the link mailed to the new address (K-192). The address is used from now on; earlier links stop working. ' +
    `Counted like any guess at a token. ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: { body: { required: true, content: { 'application/json': { schema: ConfirmAdminEmailRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: ConfirmAdminEmailResponse } }, description: 'The new address' },
    400: errorResponse('`invalid_token`: unknown, used or expired'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_options'),
    429: errorResponse('Too many guesses: wait (Retry-After)'),
  },
})

export function createSettingsApp(services: Services): OpenAPIHono<AppEnv> {
  const context = (c: Parameters<typeof getClientIp>[0]) => ({ ip: getClientIp(c), requestId: c.get('requestId') })
  const settings = services.settings
  return new OpenAPIHono<AppEnv>()
    .openapi(general.get, async (c) => c.json(await settings.general(await requireSession(c)), 200))
    .openapi(general.patch, async (c) =>
      c.json(await settings.updateGeneral(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
    .openapi(confirmRoute, async (c) => {
      const auth = await requireSession(c)
      const adminEmail = await settings.confirmAdminEmail(auth, c.req.valid('json').token, context(c))
      return c.json({ adminEmail }, 200)
    })
    .openapi(writing.get, async (c) => c.json(await settings.writing(await requireSession(c)), 200))
    .openapi(writing.patch, async (c) =>
      c.json(await settings.updateWriting(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
    .openapi(reading.get, async (c) => c.json(await settings.reading(await requireSession(c)), 200))
    .openapi(reading.patch, async (c) =>
      c.json(await settings.updateReading(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
    .openapi(privacy.get, async (c) => c.json(await settings.privacy(await requireSession(c)), 200))
    .openapi(privacy.patch, async (c) =>
      c.json(await settings.updatePrivacy(await requireSession(c), c.req.valid('json'), context(c)), 200),
    )
}
