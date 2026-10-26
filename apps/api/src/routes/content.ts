import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  ContentAuthorsQuery,
  ContentAuthorsResponse,
  ContentBulkRequest,
  ContentBulkResponse,
  ContentIdParams,
  ContentItem,
  ContentListQuery,
  ContentListResponse,
  CreateContentRequest,
  InvalidBlocksResponse,
  UpdateContentRequest,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireAnyCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// The content API (M1.1). The door lets in an account that can edit posts or pages (`edit_posts` or `edit_pages`); the service then
// checks the capabilities of the type in question (`edit_pages` for a page) and of the item (`edit_post`, `delete_post`, publishing),
// so a role that may edit pages only works with pages.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TAG = 'content'
const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body (if there is one).'
const POLICY = requireAnyCapability('edit_posts', 'edit_pages')

const itemResponse = (description: string) => ({
  content: { 'application/json': { schema: ContentItem } },
  description,
})

const writeErrors = {
  400: {
    content: { 'application/json': { schema: InvalidBlocksResponse } },
    description:
      'Invalid request, or a change that does not fit: `invalid_blocks` (with the issues), `invalid_schedule`, `invalid_parent`, ' +
      '`invalid_author`, `sticky_not_supported`, `private_with_password`',
  },
  401: errorResponse('Not signed in'),
  403: errorResponse(
    'CSRF token missing or wrong; no right to the type or the item (`forbidden`); `cannot_publish` (publish, schedule or ' +
      'private without the publish capability), `cannot_assign_authors`, `cannot_stick`',
  ),
  404: errorResponse('No such item, or one the account cannot see'),
  409: errorResponse('`content_trashed`: the item is in the trash; restore it first'),
}

const listRoute = defineRoute({
  method: 'get',
  path: '/content',
  tags: [TAG],
  summary: 'List posts or pages',
  description:
    "WordPress' edit.php. Needs the type's edit capability (`edit_posts`, `edit_pages`). Someone else's private item is listed " +
    'only with `read_private_*`. `X-Total-Count` and `X-Total-Pages` give the size of the result. Pages without a search and in ' +
    '`menu_order` come as a tree (`depth`).',
  policy: POLICY,
  request: { query: ContentListQuery },
  responses: {
    200: {
      content: { 'application/json': { schema: ContentListResponse } },
      description: 'One page of items, the views and the months',
    },
    400: errorResponse('Invalid query'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No edit capability for the type'),
  },
})

const createRoute = defineRoute({
  method: 'post',
  path: '/content',
  tags: [TAG],
  summary: 'Make a post or a page',
  description:
    'A new item by the signed-in account (a draft unless `status` says otherwise). The slug is made from `slug`, or the title, or ' +
    `the short id, as WordPress' sanitize_title does, and numbered when taken. ${STATE_CHANGING_NOTE}`,
  policy: POLICY,
  request: { body: { required: true, content: { 'application/json': { schema: CreateContentRequest } } } },
  responses: { 201: itemResponse('Made'), ...writeErrors },
})

const getRoute = defineRoute({
  method: 'get',
  path: '/content/{id}',
  tags: [TAG],
  summary: 'One post or page, with its blocks',
  description:
    "A draft, pending, scheduled or trashed item needs `edit_post`; a private one is its authors' and `read_private_*`'s.",
  policy: POLICY,
  request: { params: ContentIdParams },
  responses: {
    200: itemResponse('The item'),
    400: errorResponse('Not an id'),
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks edit_posts'),
    404: errorResponse('No such item, or one the account cannot see'),
  },
})

const updateRoute = defineRoute({
  method: 'patch',
  path: '/content/{id}',
  tags: [TAG],
  summary: 'Change a post or a page',
  description: `Changes the fields that are sent. Needs \`edit_post\`; publishing, scheduling and private need the publish capability. ${STATE_CHANGING_NOTE}`,
  policy: POLICY,
  request: {
    params: ContentIdParams,
    body: { required: true, content: { 'application/json': { schema: UpdateContentRequest } } },
  },
  responses: { 200: itemResponse('Changed'), ...writeErrors },
})

const deleteRoute = defineRoute({
  method: 'delete',
  path: '/content/{id}',
  tags: [TAG],
  summary: 'Delete a trashed item for good',
  description:
    "WordPress' «Slett permanent». Only an item in the trash; its child pages move to its parent. Needs `delete_post`. " +
    STATE_CHANGING_NOTE,
  policy: POLICY,
  request: { params: ContentIdParams },
  responses: {
    204: { description: 'Deleted' },
    400: errorResponse('Not an id'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no delete right'),
    404: errorResponse('No such item, or one the account cannot see'),
    409: errorResponse('`not_trashed`: move it to the trash first'),
  },
})

const actionRoute = (action: 'publish' | 'trash' | 'restore', summary: string, description: string) =>
  defineRoute({
    method: 'post',
    path: `/content/{id}/${action}`,
    tags: [TAG],
    summary,
    description: `${description} ${STATE_CHANGING_NOTE}`,
    policy: POLICY,
    request: { params: ContentIdParams },
    responses: {
      200: itemResponse('The item afterwards'),
      400: errorResponse('Not an id, or no date for a scheduled item'),
      401: errorResponse('Not signed in'),
      403: errorResponse('CSRF token missing or wrong, or no right to do it'),
      404: errorResponse('No such item, or one the account cannot see'),
      409: errorResponse('`content_trashed` or `not_trashed`'),
    },
  })

const publishRoute = actionRoute(
  'publish',
  'Publish',
  'Publishes now, or schedules when the publish date is in the future. Needs `edit_post` and the publish capability. An item ' +
    'that is published already is left as it is.',
)
const trashRoute = actionRoute(
  'trash',
  'Move to the trash',
  'Needs `delete_post`. The slug gets `__trashed`, and the status is kept for «Gjenopprett». The trash is emptied after 30 days.',
)
const restoreRoute = actionRoute(
  'restore',
  'Restore from the trash',
  'Needs `delete_post`. Back to the status it had, with its slug (numbered if another item took it meanwhile).',
)

const authorsRoute = defineRoute({
  method: 'get',
  path: '/content/authors',
  tags: [TAG],
  summary: 'Who can be an author',
  description:
    "The active accounts that can edit the type (WordPress' author list in quick edit). Needs `edit_others_*` of the type, as " +
    'choosing an author does.',
  policy: POLICY,
  request: { query: ContentAuthorsQuery },
  responses: {
    200: { content: { 'application/json': { schema: ContentAuthorsResponse } }, description: 'The accounts' },
    400: errorResponse('Invalid query'),
    401: errorResponse('Not signed in'),
    403: errorResponse('The account may not choose authors of the type'),
  },
})

const bulkRoute = defineRoute({
  method: 'post',
  path: '/content/bulk',
  tags: [TAG],
  summary: 'Bulk actions',
  description:
    "WordPress' bulk actions: `trash`, `restore`, `delete` (trashed items only), `edit` (status, author, comments, sticky, parent, " +
    'template), and `empty_trash` for a type. Each item is checked on its own, as the single routes do; one that is refused is ' +
    `named in \`skipped\` with the reason and the others are done. ${STATE_CHANGING_NOTE}`,
  policy: POLICY,
  request: { body: { required: true, content: { 'application/json': { schema: ContentBulkRequest } } } },
  responses: {
    200: {
      content: { 'application/json': { schema: ContentBulkResponse } },
      description: 'What was done and what was not',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no edit capability for the type (empty_trash)'),
  },
})

/** Routes under /api/v1/content. */
// The return type is spelled out so that `app.route(...)` in app.ts does not build one ever deeper type per router (TS2589).
export function createContentApp(services: Services): OpenAPIHono<AppEnv> {
  const context = (c: Parameters<typeof getClientIp>[0]) => ({ ip: getClientIp(c), requestId: c.get('requestId') })
  return new OpenAPIHono<AppEnv>()
    .openapi(listRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.content.list(auth, c.req.valid('query'))
      c.header('X-Total-Count', String(result.total))
      c.header('X-Total-Pages', String(result.totalPages))
      return c.json(result, 200)
    })
    .openapi(authorsRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.authors(auth, c.req.valid('query').type), 200)
    })
    .openapi(bulkRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.bulk(auth, c.req.valid('json'), context(c)), 200)
    })
    .openapi(createRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.create(auth, c.req.valid('json'), context(c)), 201)
    })
    .openapi(getRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.get(auth, c.req.valid('param').id), 200)
    })
    .openapi(updateRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.update(auth, c.req.valid('param').id, c.req.valid('json'), context(c)), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const auth = await requireSession(c)
      await services.content.remove(auth, c.req.valid('param').id, context(c))
      return c.body(null, 204)
    })
    .openapi(publishRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.publish(auth, c.req.valid('param').id, context(c)), 200)
    })
    .openapi(trashRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.trash(auth, c.req.valid('param').id, context(c)), 200)
    })
    .openapi(restoreRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.content.restore(auth, c.req.valid('param').id, context(c)), 200)
    })
}
