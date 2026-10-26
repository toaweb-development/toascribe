import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ApiError,
  CreateTermRequest,
  TaxonomyListResponse,
  TaxonomyParams,
  TermBulkRequest,
  TermBulkResponse,
  TermItem,
  TermListQuery,
  TermListResponse,
  TermParams,
  UpdateTermRequest,
} from '@toascribe/shared'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireAnyCapability, requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'
import { MANAGE_TERMS } from '../services/terms.ts'

// Taxonomies and terms (M1.2): reading for those who can edit content, changing for `manage_categories`.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TAG = 'taxonomies'
const READ = requireAnyCapability('edit_posts', 'edit_pages')
const MANAGE = requireCapability(MANAGE_TERMS)
const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body (if there is one).'

const termResponse = (description: string) => ({
  content: { 'application/json': { schema: TermItem } },
  description,
})

const writeErrors = {
  400: errorResponse('Invalid request, or `invalid_parent` (tags have none; never the term itself or one below it)'),
  401: errorResponse('Not signed in'),
  403: errorResponse('CSRF token missing or wrong, or no manage_categories'),
  404: errorResponse('No such taxonomy or term'),
  409: errorResponse('`term_exists`: a term with this name already exists under the same parent'),
}

const taxonomiesRoute = defineRoute({
  method: 'get',
  path: '/taxonomies',
  tags: [TAG],
  summary: 'The taxonomies',
  description: 'Categories and tags, with the default term of each (`Ukategorisert` for categories).',
  policy: READ,
  responses: {
    200: { content: { 'application/json': { schema: TaxonomyListResponse } }, description: 'The taxonomies' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No capability to edit content'),
  },
})

const listRoute = defineRoute({
  method: 'get',
  path: '/taxonomies/{tax}/terms',
  tags: [TAG],
  summary: 'List the terms of a taxonomy',
  description:
    "WordPress' edit-tags.php. Categories in name order without a search come as a tree (`depth`). `count` is the published " +
    'items that have the term. `X-Total-Count` and `X-Total-Pages` give the size of the result.',
  policy: READ,
  request: { params: TaxonomyParams, query: TermListQuery },
  responses: {
    200: { content: { 'application/json': { schema: TermListResponse } }, description: 'One page of terms' },
    400: errorResponse('Invalid query'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No capability to edit content'),
    404: errorResponse('No such taxonomy'),
  },
})

const getRoute = defineRoute({
  method: 'get',
  path: '/taxonomies/{tax}/terms/{id}',
  tags: [TAG],
  summary: 'One term',
  policy: READ,
  request: { params: TermParams },
  responses: {
    200: termResponse('The term'),
    400: errorResponse('Invalid id'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No capability to edit content'),
    404: errorResponse('No such term'),
  },
})

const createRoute = defineRoute({
  method: 'post',
  path: '/taxonomies/{tax}/terms',
  tags: [TAG],
  summary: 'Make a term',
  description:
    "The slug is made from `slug` or the name as WordPress' sanitize_title does, and made unique in the taxonomy (a child category " +
    `first tries \`<slug>-<parent slug>\`). ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: {
    params: TaxonomyParams,
    body: { required: true, content: { 'application/json': { schema: CreateTermRequest } } },
  },
  responses: { 201: termResponse('Made'), ...writeErrors },
})

const updateRoute = defineRoute({
  method: 'patch',
  path: '/taxonomies/{tax}/terms/{id}',
  tags: [TAG],
  summary: 'Change a term',
  description: `Changes the fields that are sent. The default category can be renamed. ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: {
    params: TermParams,
    body: { required: true, content: { 'application/json': { schema: UpdateTermRequest } } },
  },
  responses: { 200: termResponse('Changed'), ...writeErrors },
})

const deleteRoute = defineRoute({
  method: 'delete',
  path: '/taxonomies/{tax}/terms/{id}',
  tags: [TAG],
  summary: 'Delete a term',
  description:
    'Its child categories move up to its parent; its posts get its parent category, or, when they are left without any, the ' +
    `default category. The default category cannot be deleted (409 \`default_term\`). ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: { params: TermParams },
  responses: {
    204: { description: 'Deleted' },
    400: errorResponse('Invalid id'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_categories'),
    404: errorResponse('No such term'),
    409: errorResponse('`default_term`: the default category'),
  },
})

const bulkRoute = defineRoute({
  method: 'post',
  path: '/taxonomies/{tax}/terms/bulk',
  tags: [TAG],
  summary: 'Delete several terms',
  description: `Each as the single delete does; the default category and unknown ids are named in \`skipped\`. ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: {
    params: TaxonomyParams,
    body: { required: true, content: { 'application/json': { schema: TermBulkRequest } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TermBulkResponse } },
      description: 'What was deleted and what was not',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_categories'),
    404: errorResponse('No such taxonomy'),
  },
})

/** Routes under /api/v1/taxonomies. */
export function createTermsApp(services: Services): OpenAPIHono<AppEnv> {
  const context = (c: Parameters<typeof getClientIp>[0]) => ({ ip: getClientIp(c), requestId: c.get('requestId') })
  return new OpenAPIHono<AppEnv>()
    .openapi(taxonomiesRoute, async (c) => c.json(await services.terms.taxonomies(await requireSession(c)), 200))
    .openapi(listRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.terms.list(auth, c.req.valid('param').tax, c.req.valid('query'))
      c.header('X-Total-Count', String(result.total))
      c.header('X-Total-Pages', String(result.totalPages))
      return c.json(result, 200)
    })
    .openapi(bulkRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.terms.bulk(auth, c.req.valid('param').tax, c.req.valid('json'), context(c)), 200)
    })
    .openapi(getRoute, async (c) => {
      const auth = await requireSession(c)
      const { tax, id } = c.req.valid('param')
      return c.json(await services.terms.get(auth, tax, id), 200)
    })
    .openapi(createRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.terms.create(auth, c.req.valid('param').tax, c.req.valid('json'), context(c)), 201)
    })
    .openapi(updateRoute, async (c) => {
      const auth = await requireSession(c)
      const { tax, id } = c.req.valid('param')
      return c.json(await services.terms.update(auth, tax, id, c.req.valid('json'), context(c)), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const auth = await requireSession(c)
      const { tax, id } = c.req.valid('param')
      await services.terms.remove(auth, tax, id, context(c))
      return c.body(null, 204)
    })
}
