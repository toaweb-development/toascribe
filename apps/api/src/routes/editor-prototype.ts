import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiError,
  InvalidBlocksResponse,
  PrototypeDocument,
  PrototypeUploadResponse,
  SavePrototypeDocumentRequest,
} from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// PROTOTYPE (M0.6): the endpoints of the editor prototype at /admin/editor-prototype. Every one needs a session and a
// capability, as any other route. The content API (M1.1) and the media library (M1.2) replace them; remove this file then.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TAG = 'prototype'
const PROTOTYPE_NOTE = 'PROTOTYPE (M0.6): replaced by the content API in M1.1. '

const getDocumentRoute = defineRoute({
  method: 'get',
  path: '/prototype/editor/document',
  tags: [TAG],
  summary: 'Read the editor prototype draft (prototype)',
  description: `${PROTOTYPE_NOTE}The signed-in account's own prototype draft, or no blocks before the first save.`,
  policy: requireCapability('edit_posts'),
  responses: {
    200: { content: { 'application/json': { schema: PrototypeDocument } }, description: 'The draft' },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks edit_posts'),
  },
})

const saveDocumentRoute = defineRoute({
  method: 'put',
  path: '/prototype/editor/document',
  tags: [TAG],
  summary: 'Save the editor prototype draft (prototype)',
  description:
    `${PROTOTYPE_NOTE}Replaces the blocks of the account's own prototype draft, creating it the first time. Every block is ` +
    'checked against its block.json first; 400 `invalid_blocks` lists the issues. Needs the X-CSRF-Token header.',
  policy: requireCapability('edit_posts'),
  request: { body: { required: true, content: { 'application/json': { schema: SavePrototypeDocumentRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: PrototypeDocument } }, description: 'Saved' },
    400: {
      content: { 'application/json': { schema: InvalidBlocksResponse } },
      description: 'Invalid blocks or request',
    },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no edit_posts'),
  },
})

const UploadForm = z.object({
  file: z.instanceof(File).openapi({ type: 'string', format: 'binary' }),
})

const uploadRoute = defineRoute({
  method: 'post',
  path: '/prototype/editor/uploads',
  tags: [TAG],
  summary: 'Upload an image for the editor prototype (prototype)',
  description:
    'PROTOTYPE (M0.6): replaced by the media library in M1.2. Keeps a PNG, JPEG, GIF or WebP image (found from its bytes) in a ' +
    "temporary folder of the api, which a restart empties; the newest 50 are kept. The request's size limit applies. " +
    'Needs the X-CSRF-Token header.',
  policy: requireCapability('upload_files'),
  bodyType: 'multipart',
  request: { body: { required: true, content: { 'multipart/form-data': { schema: UploadForm } } } },
  responses: {
    201: { content: { 'application/json': { schema: PrototypeUploadResponse } }, description: 'Stored' },
    400: errorResponse('Not an image of an allowed type'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no upload_files'),
    413: errorResponse('Too large'),
  },
})

const readUploadRoute = defineRoute({
  method: 'get',
  path: '/prototype/editor/uploads/{name}',
  tags: [TAG],
  summary: 'An image uploaded for the editor prototype (prototype)',
  description: 'PROTOTYPE (M0.6). Served with its own type and nosniff, to signed-in accounts that can edit posts.',
  policy: requireCapability('edit_posts'),
  request: { params: z.object({ name: z.string().max(64) }) },
  responses: {
    200: {
      content: { 'image/*': { schema: z.string().openapi({ type: 'string', format: 'binary' }) } },
      description: 'The image',
    },
    401: errorResponse('Not signed in'),
    403: errorResponse('The account lacks edit_posts'),
    404: errorResponse('No such image'),
  },
})

/** Routes under /api/v1/prototype/editor. */
export function createEditorPrototypeApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>()
    .openapi(getDocumentRoute, async (c) =>
      c.json(await services.editorPrototype.getDocument(await requireSession(c)), 200),
    )
    .openapi(saveDocumentRoute, async (c) => {
      const auth = await requireSession(c)
      const { blocks } = c.req.valid('json')
      return c.json(await services.editorPrototype.saveDocument(auth, blocks), 200)
    })
    .openapi(uploadRoute, async (c) => {
      await requireSession(c)
      const { file } = c.req.valid('form')
      return c.json(await services.editorPrototype.saveUpload(file), 201)
    })
    .openapi(readUploadRoute, async (c) => {
      await requireSession(c)
      const image = await services.editorPrototype.readUpload(c.req.valid('param').name)
      c.header('Content-Type', image.type)
      c.header('Content-Disposition', 'inline')
      c.header('X-Content-Type-Options', 'nosniff')
      return c.body(image.bytes.slice().buffer, 200)
    })
}
