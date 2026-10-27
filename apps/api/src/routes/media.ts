import { Readable } from 'node:stream'

import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiError,
  CreateMediaFolderRequest,
  MediaDetail,
  MediaEditRequest,
  MediaFolderListResponse,
  MediaFromUrlRequest,
  MediaIdParams,
  MediaItem,
  MediaListQuery,
  MediaListResponse,
  MediaRegenerateRequest,
  MediaRegenerateResponse,
  MediaSettingsResponse,
  UpdateMediaFolderRequest,
  UpdateMediaRequest,
  UpdateMediaSettingsRequest,
} from '@toascribe/shared'
import type { Context } from 'hono'

import { getClientIp } from '../lib/client-ip.ts'
import type { AppEnv } from '../lib/env.ts'
import { requireCapability } from '../lib/policy.ts'
import { requireSession } from '../middleware/auth.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { OpenedFile } from '../services/media.ts'
import type { Services } from '../services/index.ts'

// The media library (M1.2): /media, /media-folders and /settings/media. `upload_files` at the door for the library; the service checks
// a file's own rights (someone else's needs edit_others_posts / delete_others_posts; a private one is its uploader's and
// read_private_posts'). Regeneration and the settings are `manage_options`.

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ApiError } },
  description,
})

const TAG = 'media'
const UPLOAD = requireCapability('upload_files')
const MANAGE = requireCapability('manage_options')
/** Renaming, moving and deleting folders (the service checks upload_files too). */
const ORGANIZE = requireCapability('edit_others_posts')
const STATE_CHANGING_NOTE =
  'Needs the X-CSRF-Token header of the session, a same-origin request and an application/json body (multipart for a file).'

const itemResponse = (description: string) => ({ content: { 'application/json': { schema: MediaItem } }, description })

const uploadErrors = {
  400: errorResponse(
    'Not allowed: `unsupported_type` (not on the list, or not for this role), `type_mismatch` (the content is not what the name ' +
      'says), `empty_file`, `unreadable_image`, `image_too_large` (more pixels than `image_max_pixels`), `invalid_folder`, `invalid_attached_to` (no such content)',
  ),
  401: errorResponse('Not signed in'),
  403: errorResponse('CSRF token missing or wrong, or no right to the file'),
  413: errorResponse('`file_too_large`: above the upload limit'),
}

const UploadForm = z.object({
  file: z.instanceof(File).openapi({ type: 'string', format: 'binary' }),
  title: z.string().max(1000).optional(),
  alt: z.string().max(1000).optional(),
  folderId: z.uuid().optional(),
  attachedTo: z.uuid().optional(),
})

const ReplaceForm = z.object({ file: z.instanceof(File).openapi({ type: 'string', format: 'binary' }) })

const listRoute = defineRoute({
  method: 'get',
  path: '/media',
  tags: [TAG],
  summary: 'The media library',
  description:
    'Files the account may see, newest first, with the type, month and folder filters and a search. `upload` says how large a file ' +
    'and which types the account may upload. `X-Total-Count` and `X-Total-Pages` give the size of the result.',
  policy: UPLOAD,
  request: { query: MediaListQuery },
  responses: {
    200: { content: { 'application/json': { schema: MediaListResponse } }, description: 'One page of files' },
    400: errorResponse('Invalid query'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No upload_files'),
  },
})

const uploadRoute = defineRoute({
  method: 'post',
  path: '/media',
  tags: [TAG],
  summary: 'Upload a file',
  description:
    'The type is found from the content and must agree with the extension; an image is checked against the pixel limit before it is ' +
    `decoded. The worker makes the sizes afterwards (\`processing\`). ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  bodyType: 'multipart',
  request: { body: { required: true, content: { 'multipart/form-data': { schema: UploadForm } } } },
  responses: { 201: itemResponse('Stored'), ...uploadErrors },
})

const fromUrlRoute = defineRoute({
  method: 'post',
  path: '/media/from-url',
  tags: [TAG],
  summary: 'Upload from an address',
  description:
    'Fetches the address with the SSRF-safe client (only public addresses, at most three redirects, the upload limit as the most ' +
    `bytes) and stores it as an upload. \`fetch_failed\` when it cannot be fetched. ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  request: { body: { required: true, content: { 'application/json': { schema: MediaFromUrlRequest } } } },
  responses: { 201: itemResponse('Stored'), ...uploadErrors },
})

const regenerateRoute = defineRoute({
  method: 'post',
  path: '/media/regenerate',
  tags: [TAG],
  summary: 'Make the image sizes again',
  description: `Queues a job per image (all, or the ids given), for example after the sizes were changed. ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: { body: { required: true, content: { 'application/json': { schema: MediaRegenerateRequest } } } },
  responses: {
    202: { content: { 'application/json': { schema: MediaRegenerateResponse } }, description: 'Queued' },
    400: errorResponse('Invalid request'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_options'),
  },
})

const getRoute = defineRoute({
  method: 'get',
  path: '/media/{id}',
  tags: [TAG],
  summary: 'One file, with where it is used',
  description:
    '`usedBy` lists the posts and pages whose blocks use the file and that the asker may read («Brukes på», K-122); ' +
    '`usedByOthers` counts the rest, without their titles.',
  policy: UPLOAD,
  request: { params: MediaIdParams },
  responses: {
    200: { content: { 'application/json': { schema: MediaDetail } }, description: 'The file' },
    400: errorResponse('Not an id'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No upload_files'),
    404: errorResponse('No such file, or a private one the account may not see'),
  },
})

const fileRoute = defineRoute({
  method: 'get',
  path: '/media/{id}/file',
  tags: [TAG],
  summary: 'The file itself',
  description:
    'Private files are served only here. `size` is a size name, `scaled`, `edited` or `original`; without it the image as shown. ' +
    'Served with nosniff, and as an attachment unless it is an image a browser shows.',
  policy: UPLOAD,
  request: {
    params: MediaIdParams,
    query: z.strictObject({
      size: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .max(40)
        .optional(),
    }),
  },
  responses: {
    200: { description: 'The file' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No upload_files'),
    404: errorResponse('No such file or size'),
  },
})

const updateRoute = defineRoute({
  method: 'patch',
  path: '/media/{id}',
  tags: [TAG],
  summary: 'Change the details of a file',
  description: `Title, alt text, caption, description, visibility and folder. ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  request: {
    params: MediaIdParams,
    body: { required: true, content: { 'application/json': { schema: UpdateMediaRequest } } },
  },
  responses: {
    200: itemResponse('Changed'),
    400: errorResponse('Invalid request or folder'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or not the account’s to change'),
    404: errorResponse('No such file'),
  },
})

const deleteRoute = defineRoute({
  method: 'delete',
  path: '/media/{id}',
  tags: [TAG],
  summary: 'Delete a file for good',
  description: `The original and every size. Blocks that used it show nothing. ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  request: { params: MediaIdParams },
  responses: {
    204: { description: 'Deleted' },
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or not the account’s to delete'),
    404: errorResponse('No such file'),
  },
})

const replaceRoute = defineRoute({
  method: 'post',
  path: '/media/{id}/replace',
  tags: [TAG],
  summary: 'Replace the file',
  description:
    'A new file under the same id (K-115), checked as an upload; links in content keep working. `media_busy` (409) while the ' +
    `worker has the file (an edit or its sizes): try again when it is ready. ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  bodyType: 'multipart',
  request: {
    params: MediaIdParams,
    body: { required: true, content: { 'multipart/form-data': { schema: ReplaceForm } } },
  },
  responses: {
    200: itemResponse('Replaced'),
    ...uploadErrors,
    404: errorResponse('No such file'),
    409: errorResponse('`media_busy`: the worker has the file'),
  },
})

const editRoute = defineRoute({
  method: 'post',
  path: '/media/{id}/edit',
  tags: [TAG],
  summary: 'Edit an image',
  description:
    'Crop, rotate, flip and scale (K-114), applied in order to the image as it is shown. The worker makes a new image and its sizes; ' +
    `the original is kept. \`invalid_edit\`, \`not_editable\`, \`media_busy\` (409). ${STATE_CHANGING_NOTE}`,
  policy: UPLOAD,
  request: {
    params: MediaIdParams,
    body: { required: true, content: { 'application/json': { schema: MediaEditRequest } } },
  },
  responses: {
    202: itemResponse('Queued'),
    400: errorResponse('Not an image, or a step that does not fit'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or not the account’s to change'),
    404: errorResponse('No such file'),
    409: errorResponse('`media_busy`: the image is still being processed'),
  },
})

const folderErrors = {
  400: errorResponse('Invalid request, or `invalid_folder`'),
  401: errorResponse('Not signed in'),
  403: errorResponse('CSRF token missing or wrong, no upload_files, or (rename, move, delete) no edit_others_posts'),
  404: errorResponse('No such folder'),
  409: errorResponse('`folder_exists`: the name is taken beside it'),
}
const foldersResponse = (description: string) => ({
  content: { 'application/json': { schema: MediaFolderListResponse } },
  description,
})

const listFoldersRoute = defineRoute({
  method: 'get',
  path: '/media-folders',
  tags: [TAG],
  summary: 'The folders of the library',
  description: 'As a tree (`depth`), with the number of files in each.',
  policy: UPLOAD,
  responses: {
    200: foldersResponse('The folders'),
    401: errorResponse('Not signed in'),
    403: errorResponse('No upload_files'),
  },
})

const createFolderRoute = defineRoute({
  method: 'post',
  path: '/media-folders',
  tags: [TAG],
  summary: 'Make a folder',
  description: STATE_CHANGING_NOTE,
  policy: UPLOAD,
  request: { body: { required: true, content: { 'application/json': { schema: CreateMediaFolderRequest } } } },
  responses: { 201: foldersResponse('The folders afterwards'), ...folderErrors },
})

const updateFolderRoute = defineRoute({
  method: 'patch',
  path: '/media-folders/{id}',
  tags: [TAG],
  summary: 'Rename or move a folder',
  description: `Needs \`edit_others_posts\` as well: a folder holds other people's files. ${STATE_CHANGING_NOTE}`,
  policy: ORGANIZE,
  request: {
    params: MediaIdParams,
    body: { required: true, content: { 'application/json': { schema: UpdateMediaFolderRequest } } },
  },
  responses: { 200: foldersResponse('The folders afterwards'), ...folderErrors },
})

const deleteFolderRoute = defineRoute({
  method: 'delete',
  path: '/media-folders/{id}',
  tags: [TAG],
  summary: 'Delete a folder',
  description: `With the folders in it; their files move to the top of the library. Needs \`edit_others_posts\` as well. ${STATE_CHANGING_NOTE}`,
  policy: ORGANIZE,
  request: { params: MediaIdParams },
  responses: { 204: { description: 'Deleted' }, ...folderErrors },
})

const settingsRoute = defineRoute({
  method: 'get',
  path: '/settings/media',
  tags: ['settings'],
  summary: 'Settings → Media',
  description:
    'The image sizes, the upload folders, the upload limit (with the cap from .env), the pixel limit and the types per role.',
  policy: MANAGE,
  responses: {
    200: { content: { 'application/json': { schema: MediaSettingsResponse } }, description: 'The settings' },
    401: errorResponse('Not signed in'),
    403: errorResponse('No manage_options'),
  },
})

const updateSettingsRoute = defineRoute({
  method: 'patch',
  path: '/settings/media',
  tags: ['settings'],
  summary: 'Change Settings → Media',
  description: `\`above_upload_cap\` when the upload limit is above UPLOAD_MAX_SIZE_MB. ${STATE_CHANGING_NOTE}`,
  policy: MANAGE,
  request: { body: { required: true, content: { 'application/json': { schema: UpdateMediaSettingsRequest } } } },
  responses: {
    200: { content: { 'application/json': { schema: MediaSettingsResponse } }, description: 'The settings afterwards' },
    400: errorResponse('Invalid request, or `above_upload_cap`'),
    401: errorResponse('Not signed in'),
    403: errorResponse('CSRF token missing or wrong, or no manage_options'),
  },
})

/** A file as the answer: its own type, nosniff, and an attachment unless it is an image a browser shows. */
export function sendFile(c: Context<AppEnv>, file: OpenedFile, cache: string): Response {
  c.header('Content-Type', file.mime)
  c.header('Content-Length', String(file.size))
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', cache)
  // Its Content-Security-Policy (a sandbox, no script, never framed) is set by the app's secure headers for the file routes (app.ts).
  const name = encodeURIComponent(file.fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  c.header('Content-Disposition', `${file.download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`)
  return c.body(Readable.toWeb(file.stream) as ReadableStream, 200)
}

/** Routes under /api/v1/media, /api/v1/media-folders and /api/v1/settings/media. */
export function createMediaApp(services: Services): OpenAPIHono<AppEnv> {
  const context = (c: Parameters<typeof getClientIp>[0]) => ({ ip: getClientIp(c), requestId: c.get('requestId') })
  return new OpenAPIHono<AppEnv>()
    .openapi(listRoute, async (c) => {
      const auth = await requireSession(c)
      const result = await services.media.list(auth, c.req.valid('query'))
      c.header('X-Total-Count', String(result.total))
      c.header('X-Total-Pages', String(result.totalPages))
      return c.json(result, 200)
    })
    .openapi(uploadRoute, async (c) => {
      const auth = await requireSession(c)
      const form = c.req.valid('form')
      const item = await services.media.upload(
        auth,
        {
          bytes: new Uint8Array(await form.file.arrayBuffer()),
          fileName: form.file.name,
          title: form.title,
          alt: form.alt,
          folderId: form.folderId,
          attachedTo: form.attachedTo,
        },
        context(c),
      )
      return c.json(item, 201)
    })
    .openapi(fromUrlRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.fromUrl(auth, c.req.valid('json'), context(c)), 201)
    })
    .openapi(regenerateRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.regenerate(auth, c.req.valid('json'), context(c)), 202)
    })
    .openapi(getRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.get(auth, c.req.valid('param').id), 200)
    })
    .openapi(fileRoute, async (c) => {
      const auth = await requireSession(c)
      const file = await services.media.openFile(auth, c.req.valid('param').id, c.req.valid('query').size)
      return sendFile(c, file, 'private, no-store')
    })
    .openapi(updateRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.update(auth, c.req.valid('param').id, c.req.valid('json'), context(c)), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const auth = await requireSession(c)
      await services.media.remove(auth, c.req.valid('param').id, context(c))
      return c.body(null, 204)
    })
    .openapi(replaceRoute, async (c) => {
      const auth = await requireSession(c)
      const { file } = c.req.valid('form')
      const item = await services.media.replace(
        auth,
        c.req.valid('param').id,
        { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name },
        context(c),
      )
      return c.json(item, 200)
    })
    .openapi(editRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.edit(auth, c.req.valid('param').id, c.req.valid('json'), context(c)), 202)
    })
    .openapi(listFoldersRoute, async (c) => c.json(await services.media.folders(await requireSession(c)), 200))
    .openapi(createFolderRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.createFolder(auth, c.req.valid('json'), context(c)), 201)
    })
    .openapi(updateFolderRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(
        await services.media.updateFolder(auth, c.req.valid('param').id, c.req.valid('json'), context(c)),
        200,
      )
    })
    .openapi(deleteFolderRoute, async (c) => {
      const auth = await requireSession(c)
      await services.media.deleteFolder(auth, c.req.valid('param').id, context(c))
      return c.body(null, 204)
    })
    .openapi(settingsRoute, async (c) => c.json(await services.media.settings(await requireSession(c)), 200))
    .openapi(updateSettingsRoute, async (c) => {
      const auth = await requireSession(c)
      return c.json(await services.media.updateSettings(auth, c.req.valid('json'), context(c)), 200)
    })
}
