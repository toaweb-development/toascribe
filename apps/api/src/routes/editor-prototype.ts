import { OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiError, PrototypeUploadResponse } from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Services } from '../services/index.ts'

// PROTOTYPE (M0.6): the image uploads of the editor. Every route needs a session and a capability, as any other route. The
// prototype's draft endpoints went with M1.1 (the editor saves through the content API); the media library (M1.2) replaces these.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TAG = 'prototype'

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

/** Routes under /api/v1/prototype/editor/uploads. */
export function createEditorPrototypeApp(services: Services): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>()
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
