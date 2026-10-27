// The media library (M1.2; K-110 to K-125). Uploads are checked here, stored, and handed to the worker, which makes the sizes:
// - size: at most `upload_max_size_mb` MiB, and within UPLOAD_MAX_SIZE_MB MiB for the whole request, which the proxy enforces too
//   (lib/upload-limit.ts);
// - type: from the bytes, and it must agree with the extension (@toascribe/media detectType); SVG, HTML, scripts and programs are
//   not on the list; a role may be limited to some groups (`upload_groups_by_role`);
// - an image's pixels are read from its header and checked against `image_max_pixels` before anything decodes it;
// - the stored name is made by the server (`YYYY/MM/<readable>-<random>.<ext>`), never taken from the request.
// Rights are WordPress' for attachments: `upload_files` to upload and to see the library; a file is its uploader's own, and someone
// else's needs `edit_others_posts` / `delete_others_posts`. A private file is seen only by its uploader and `read_private_posts`.
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import type { Database } from '@toascribe/db'
import { SafeFetchError, safeFetch } from '@toascribe/http'
import {
  MEDIA_TYPES,
  RESIZABLE_MIMES,
  contentExtension,
  WEB_IMAGE_MIMES,
  detectType,
  extensionOf,
  headerDimensions,
  originalKey,
  shownFile,
} from '@toascribe/media'
import type { MediaStorage, ShownFile } from '@toascribe/media'
import {
  ContentStatus,
  ContentStatusBeforeTrash,
  ContentTypeKey,
  CoreSettings,
  MediaFailure,
  MediaSettings,
  MediaVariantsData,
} from '@toascribe/shared'
import type {
  ContentMediaRef,
  CreateMediaFolderRequest,
  MediaDetail,
  MediaEditOperation,
  MediaEditRequest,
  MediaFolderListResponse,
  MediaFromUrlRequest,
  MediaGroup,
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
import type { Logger } from 'pino'

import type { SessionAuth } from '../lib/auth-context.ts'
import { canRead as canReadContent } from '../lib/content-access.ts'
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.ts'
import { uploadFileLimit } from '../lib/upload-limit.ts'
import type { MediaJobPort } from '../ports/media-jobs.ts'
import { authorsOf, findContent } from '../repositories/content.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import {
  accountNames,
  countMedia,
  deleteFolder,
  deleteMedia,
  findFolder,
  findMedia,
  findMediaByKey,
  folderAncestorIds,
  folderNameTaken,
  insertFolder,
  insertMedia,
  listFolders,
  listMediaMonths,
  listMediaPage,
  lockFolders,
  mediaUsage,
  updateFolder,
  updateMedia,
  variantKeys,
} from '../repositories/media.ts'
import type { MediaFilter, MediaRow } from '../repositories/media.ts'
import { readSettings, writeSettings } from '../repositories/settings.ts'
import { flattenTree } from './content.ts'
import type { Auditor, RequestContext } from './support.ts'

const SETTINGS = CoreSettings.pick({
  upload_max_size_mb: true,
  image_max_pixels: true,
  upload_groups_by_role: true,
  uploads_use_yearmonth_folders: true,
  timezone_string: true,
  gmt_offset: true,
})

/** A file opened for serving. */
export interface OpenedFile {
  readonly stream: Readable
  readonly mime: string
  readonly size: number
  /** The name a download gets. */
  readonly fileName: string
  /** Not an image a browser shows: served with `Content-Disposition: attachment`. */
  readonly download: boolean
  readonly visibility: 'public' | 'private'
}

export interface UploadInput {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly title?: string | undefined
  readonly alt?: string | undefined
  readonly folderId?: string | null | undefined
  readonly attachedTo?: string | null | undefined
}

export interface MediaService {
  list: (auth: SessionAuth, query: MediaListQuery) => Promise<MediaListResponse>
  get: (auth: SessionAuth, id: string) => Promise<MediaDetail>
  upload: (auth: SessionAuth, input: UploadInput, ctx: RequestContext) => Promise<MediaItem>
  fromUrl: (auth: SessionAuth, request: MediaFromUrlRequest, ctx: RequestContext) => Promise<MediaItem>
  update: (auth: SessionAuth, id: string, request: UpdateMediaRequest, ctx: RequestContext) => Promise<MediaItem>
  remove: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<void>
  replace: (auth: SessionAuth, id: string, input: UploadInput, ctx: RequestContext) => Promise<MediaItem>
  edit: (auth: SessionAuth, id: string, request: MediaEditRequest, ctx: RequestContext) => Promise<MediaItem>
  regenerate: (
    auth: SessionAuth,
    request: MediaRegenerateRequest,
    ctx: RequestContext,
  ) => Promise<MediaRegenerateResponse>
  /** A public file under /uploads/<key>; undefined when there is none, or it is private. */
  openPublic: (key: string) => Promise<OpenedFile | undefined>
  /** A file through the api, with the rights check: `which` is a size name, `original`, or the shown image. */
  openFile: (auth: SessionAuth, id: string, which: string | undefined) => Promise<OpenedFile>
  folders: (auth: SessionAuth) => Promise<MediaFolderListResponse>
  createFolder: (
    auth: SessionAuth,
    request: CreateMediaFolderRequest,
    ctx: RequestContext,
  ) => Promise<MediaFolderListResponse>
  updateFolder: (
    auth: SessionAuth,
    id: string,
    request: UpdateMediaFolderRequest,
    ctx: RequestContext,
  ) => Promise<MediaFolderListResponse>
  deleteFolder: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<void>
  /** The media a document uses, for its editor and view (private ones only for their uploader and read_private_posts). */
  contentRefs: (
    actor: { id: string; capabilities: ReadonlySet<string> },
    ids: readonly string[],
  ) => Promise<ContentMediaRef[]>
  /** The ids of the files at these addresses (`/uploads/<key>`, also with this site's origin): the image block's migration. */
  idsForUrls: (urls: readonly string[]) => Promise<Map<string, string>>
  settings: (auth: SessionAuth) => Promise<MediaSettingsResponse>
  updateSettings: (
    auth: SessionAuth,
    request: UpdateMediaSettingsRequest,
    ctx: RequestContext,
  ) => Promise<MediaSettingsResponse>
}

function groupOf(mime: string): MediaGroup {
  return Object.values(MEDIA_TYPES).find((entry) => entry.mime === mime)?.group ?? 'document'
}

/** The MIME types of a group, for the type filter. */
function mimesOf(group: MediaGroup): string[] {
  return [
    ...new Set(
      Object.values(MEDIA_TYPES)
        .filter((entry) => entry.group === group)
        .map((entry) => entry.mime),
    ),
  ]
}

function intlTimeZone(settings: { timezone_string: string; gmt_offset: number }): string {
  if (settings.timezone_string !== '') {
    return settings.timezone_string
  }
  const minutes = Math.round(Math.abs(settings.gmt_offset) * 60)
  const sign = settings.gmt_offset < 0 ? '-' : '+'
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The image as it is shown: the edited one, the `-scaled` copy, the original when a browser shows it, or the largest size. */
/** The image as it is shown (the one rule of @toascribe/media, which the worker edits too). */
function shownVariant(row: MediaRow): ShownFile {
  return shownFile({ key: row.storageKey, width: row.width, height: row.height, mime: row.mime }, row.variants)
}

/** The size of the image after the edit steps, and whether every step fits (a crop inside it, a scale that does not enlarge). */
export function editedSize(
  width: number,
  height: number,
  operations: readonly MediaEditOperation[],
): { width: number; height: number } {
  let w = width
  let h = height
  for (const step of operations) {
    switch (step.op) {
      case 'crop':
        if (step.x + step.width > w || step.y + step.height > h) {
          throw new AppError(400, 'invalid_edit', 'A crop must lie inside the image')
        }
        w = step.width
        h = step.height
        break
      case 'rotate':
        if (step.degrees !== 180) {
          ;[w, h] = [h, w]
        }
        break
      case 'flip':
        break
      case 'scale':
        if (step.width > w) {
          throw new AppError(400, 'invalid_edit', 'An image can be scaled down, not up')
        }
        h = Math.max(1, Math.round((h * step.width) / w))
        w = step.width
        break
      default:
        step satisfies never
    }
  }
  return { width: w, height: h }
}

export function createMediaService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly storage: MediaStorage
  readonly jobs: MediaJobPort
  readonly logger: Logger
  /** UPLOAD_MAX_SIZE_MB: the cap above any setting. */
  readonly uploadCapMb: number
  /** PUBLIC_ORIGIN: an absolute address on this site counts as the path. */
  readonly publicOrigin: string
  readonly onInvalidSetting?: (key: string) => void
}): MediaService {
  const { db, clock, audit, storage, jobs, logger } = options

  const settingsOf = (executor: Executor = db) => readSettings(executor, SETTINGS, options.onInvalidSetting)

  const has = (auth: SessionAuth, capability: string) => auth.capabilities.has(capability)
  const isOwn = (auth: SessionAuth, row: MediaRow) => row.uploadedBy === auth.account.id
  const canRead = (auth: SessionAuth, row: MediaRow) =>
    has(auth, 'upload_files') && (row.visibility === 'public' || isOwn(auth, row) || has(auth, 'read_private_posts'))
  const canEdit = (auth: SessionAuth, row: MediaRow) =>
    canRead(auth, row) && has(auth, isOwn(auth, row) ? 'edit_posts' : 'edit_others_posts')
  const canDelete = (auth: SessionAuth, row: MediaRow) =>
    canRead(auth, row) && has(auth, isOwn(auth, row) ? 'delete_posts' : 'delete_others_posts')

  function requireUpload(auth: SessionAuth): void {
    if (!has(auth, 'upload_files')) {
      throw new ForbiddenError()
    }
  }

  /** Renaming, moving and deleting a folder: it holds other people's files, so `edit_others_posts` as well (making one needs only
   * upload_files). */
  function requireOrganize(auth: SessionAuth): void {
    if (!has(auth, 'upload_files') || !has(auth, 'edit_others_posts')) {
      throw new ForbiddenError()
    }
  }

  function urlOf(row: MediaRow, key: string, which: string): string {
    return row.visibility === 'public'
      ? `/uploads/${key}`
      : `/api/v1/media/${row.id}/file${which === 'shown' ? '' : `?size=${encodeURIComponent(which)}`}`
  }

  function toItem(auth: SessionAuth, row: MediaRow, names: ReadonlyMap<string, string>): MediaItem {
    const shown = shownVariant(row)
    return {
      id: row.id,
      title: row.title,
      alt: row.alt,
      caption: row.caption,
      description: row.description,
      mime: row.mime,
      group: groupOf(row.mime),
      fileName: row.fileName,
      size: row.size,
      width: shown.width,
      height: shown.height,
      visibility: row.visibility,
      folderId: row.folderId,
      uploadedBy: row.uploadedBy === null ? null : { id: row.uploadedBy, displayName: names.get(row.uploadedBy) ?? '' },
      attachedTo: row.attachedTo,
      processing: row.processing,
      // A code (MEDIA_FAILURES); anything else stored there (an older message) is shown as unknown, never sent.
      processingError:
        row.processing === 'failed' ? (MediaFailure.safeParse(row.processingError).data ?? 'unknown') : null,
      url: urlOf(row, shown.key, 'shown'),
      originalUrl: urlOf(row, row.storageKey, 'original'),
      sizes: Object.entries(row.variants.sizes)
        .map(([name, size]) => ({ name, width: size.width, height: size.height, url: urlOf(row, size.key, name) }))
        .sort((a, b) => a.width - b.width),
      createdAt: row.createdAt.toISOString(),
      modifiedAt: row.modifiedAt.toISOString(),
      can: { edit: canEdit(auth, row), delete: canDelete(auth, row) },
    }
  }

  async function itemOf(auth: SessionAuth, id: string): Promise<MediaItem> {
    const row = await findMedia(db, id)
    if (row === undefined || !canRead(auth, row)) {
      throw new NotFoundError()
    }
    const names = await accountNames(db, row.uploadedBy === null ? [] : [row.uploadedBy])
    return toItem(auth, row, names)
  }

  /** The groups the account's roles may upload; undefined when one of its roles is not limited. */
  function allowedGroups(
    auth: SessionAuth,
    byRole: Readonly<Record<string, readonly MediaGroup[]>>,
  ): MediaGroup[] | undefined {
    const lists = auth.roles.map((role) => byRole[role])
    if (lists.length === 0 || lists.some((list) => list === undefined)) {
      return undefined
    }
    return [...new Set(lists.flatMap((list) => list ?? []))]
  }

  function maxBytes(settings: { upload_max_size_mb: number }): number {
    return uploadFileLimit(settings.upload_max_size_mb, options.uploadCapMb)
  }

  /** The checks every upload passes (also a replacement and a fetch from a URL). Throws AppError; returns what to store. */
  async function check(auth: SessionAuth, input: UploadInput) {
    const settings = await settingsOf()
    if (input.bytes.length > maxBytes(settings)) {
      throw new AppError(413, 'file_too_large', 'The file is larger than the upload limit')
    }
    const detection = await detectType(input.bytes, input.fileName, allowedGroups(auth, settings.upload_groups_by_role))
    if (!detection.ok) {
      const messages = {
        unsupported_type: 'This file type is not allowed',
        type_mismatch: 'The content of the file is not what its name says',
        empty_file: 'The file is empty',
      } as const
      throw new AppError(400, detection.reason, messages[detection.reason])
    }
    let width: number | null = null
    let height: number | null = null
    if (detection.group === 'image') {
      const dimensions = headerDimensions(input.bytes)
      if (dimensions === undefined && RESIZABLE_MIMES.has(detection.mime)) {
        throw new AppError(400, 'unreadable_image', 'The image cannot be read')
      }
      if (dimensions !== undefined) {
        if (dimensions.width * dimensions.height > settings.image_max_pixels) {
          throw new AppError(400, 'image_too_large', 'The image has more pixels than the site allows')
        }
        width = dimensions.width
        height = dimensions.height
      }
    }
    return { detection, width, height, settings }
  }

  async function checkFolder(executor: Executor, folderId: string | null | undefined): Promise<string | null> {
    if (folderId === undefined || folderId === null) {
      return null
    }
    if ((await findFolder(executor, folderId)) === undefined) {
      throw new AppError(400, 'invalid_folder', 'The folder does not exist')
    }
    return folderId
  }

  /** Sends a job after the change is committed. A failure is logged; the worker's sweep finds the file still pending and queues it. */
  async function queue(job: Parameters<MediaJobPort['send']>[0]): Promise<void> {
    try {
      await jobs.send(job)
    } catch (err) {
      logger.error({ err, mediaId: job.mediaId, kind: job.kind }, 'could not queue a media job; the sweep will retry')
    }
  }

  async function removeFiles(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      await storage.remove(key).catch((err: unknown) => {
        logger.warn({ err, key }, 'could not remove a media file')
      })
    }
  }

  async function ingest(auth: SessionAuth, input: UploadInput, ctx: RequestContext): Promise<MediaItem> {
    requireUpload(auth)
    const { detection, width, height, settings } = await check(auth, input)
    const now = clock()
    const key = originalKey(input.fileName, detection.ext, now, settings.uploads_use_yearmonth_folders)
    await storage.put(key, input.bytes)
    const resizable = RESIZABLE_MIMES.has(detection.mime)
    let id: string
    try {
      id = await inTransaction(db, async (tx) => {
        const folderId = await checkFolder(tx, input.folderId)
        if (input.attachedTo !== undefined && input.attachedTo !== null) {
          if ((await findContent(tx, input.attachedTo)) === undefined) {
            throw new AppError(400, 'invalid_attached_to', 'The content to attach the file to does not exist')
          }
        }
        const created = await insertMedia(
          tx,
          {
            title: (input.title ?? '').trim() || input.fileName.replace(/\.[^.]*$/, '').slice(0, 1000),
            alt: input.alt ?? '',
            caption: '',
            description: '',
            mime: detection.mime,
            size: input.bytes.length,
            width,
            height,
            sha256: createHash('sha256').update(input.bytes).digest('hex'),
            folderId,
            uploadedBy: auth.account.id,
            attachedTo: input.attachedTo ?? null,
            visibility: 'public',
            storageKey: key,
            fileName: input.fileName.split(/[\\/]/).pop()?.slice(0, 255) ?? '',
            processing: resizable ? 'pending' : 'ready',
          },
          now,
        )
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media.uploaded',
          objectType: 'media',
          objectId: created,
          newValue: { mime: detection.mime, size: input.bytes.length },
        })
        return created
      })
    } catch (err) {
      await removeFiles([key])
      throw err
    }
    if (resizable) {
      await queue({ kind: 'process', mediaId: id })
    }
    return itemOf(auth, id)
  }

  /** The file a row's key or size name points at. */
  async function open(row: MediaRow, key: string, isOriginal: boolean): Promise<OpenedFile> {
    const stat = await storage.stat(key)
    if (stat === undefined) {
      throw new NotFoundError()
    }
    const mime = isOriginal ? row.mime : 'image/webp'
    return {
      stream: storage.stream(key),
      mime,
      size: stat.size,
      fileName: (isOriginal && row.fileName !== '' ? row.fileName : key.split('/').pop()) ?? 'file',
      download: !(WEB_IMAGE_MIMES.has(mime) || mime === 'image/webp'),
      visibility: row.visibility,
    }
  }

  async function folderList(auth: SessionAuth): Promise<MediaFolderListResponse> {
    requireUpload(auth)
    const rows = await listFolders(db)
    const flat = flattenTree(rows)
    const byId = new Map(rows.map((row) => [row.id, row]))
    return {
      folders: flat.flatMap((entry) => {
        const row = byId.get(entry.id)
        return row === undefined ? [] : [{ ...row, depth: entry.depth }]
      }),
    }
  }

  async function mediaSettings(auth: SessionAuth): Promise<MediaSettingsResponse> {
    if (!has(auth, 'manage_options')) {
      throw new ForbiddenError()
    }
    const settings = await readSettings(db, MediaSettings, options.onInvalidSetting)
    return { settings, uploadMaxSizeCapMb: options.uploadCapMb }
  }

  return {
    async list(auth, query) {
      requireUpload(auth)
      const settings = await settingsOf()
      const filter: MediaFilter = {
        search: query.search,
        mimes: query.group === undefined ? undefined : mimesOf(query.group),
        month: query.month,
        folder: query.folder,
        uploadedBy: query.mine === 'true' ? auth.account.id : undefined,
        ids: query.ids?.toLowerCase().split(','),
        accountId: auth.account.id,
        readPrivate: has(auth, 'read_private_posts'),
        timeZone: intlTimeZone(settings),
      }
      const offset = (query.page - 1) * query.per_page
      const [rows, total, months] = await Promise.all([
        listMediaPage(db, filter, query.orderby, query.order, query.per_page, offset),
        countMedia(db, filter),
        listMediaMonths(db, filter),
      ])
      const names = await accountNames(db, [
        ...new Set(rows.flatMap((row) => (row.uploadedBy === null ? [] : [row.uploadedBy]))),
      ])
      const groups = allowedGroups(auth, settings.upload_groups_by_role)
      return {
        items: rows.map((row) => toItem(auth, row, names)),
        total,
        totalPages: Math.ceil(total / query.per_page),
        page: query.page,
        perPage: query.per_page,
        months,
        upload: {
          maxBytes: maxBytes(settings),
          extensions: Object.entries(MEDIA_TYPES)
            .filter(([, entry]) => groups === undefined || groups.includes(entry.group))
            .map(([ext]) => ext),
        },
      }
    },

    async get(auth, id) {
      requireUpload(auth)
      const item = await itemOf(auth, id)
      const usage = await mediaUsage(db, id)
      const authors = await authorsOf(
        db,
        usage.map((entry) => entry.id),
      )
      const actor = { id: auth.account.id, capabilities: auth.capabilities }
      const readable = usage.flatMap((entry) => {
        const type = ContentTypeKey.safeParse(entry.type)
        const status = ContentStatus.safeParse(entry.status)
        if (!type.success || !status.success) return []
        const before = ContentStatusBeforeTrash.safeParse(entry.statusBeforeTrash)
        const access = {
          type: type.data,
          status: status.data,
          statusBeforeTrash: before.success ? before.data : null,
          authorIds: (authors.get(entry.id) ?? []).map((author) => author.id),
        }
        return canReadContent(actor, access)
          ? [{ id: entry.id, type: type.data, title: entry.title, status: entry.status }]
          : []
      })
      // The rest is counted, never named (a private post of someone else, a draft the asker may not edit).
      return { ...item, usedBy: readable, usedByOthers: usage.length - readable.length }
    },

    upload: ingest,

    async fromUrl(auth, request, ctx) {
      requireUpload(auth)
      const settings = await settingsOf()
      let response
      try {
        response = await safeFetch(request.url, { maxBytes: maxBytes(settings), timeoutMs: 30_000 })
      } catch (err) {
        if (err instanceof SafeFetchError) {
          throw new AppError(400, 'fetch_failed', 'The address could not be fetched', { cause: err })
        }
        throw err
      }
      if (response.status !== 200) {
        throw new AppError(400, 'fetch_failed', 'The address did not answer with a file')
      }
      // The name from the address; when it has no known extension, the one the content shows (the content is checked anyway).
      let fileName = decodeURIComponent(new URL(response.url).pathname.split('/').pop() ?? '') || 'file'
      if (MEDIA_TYPES[extensionOf(fileName)] === undefined) {
        fileName = `${fileName.replace(/\.[^.]*$/, '')}.${(await contentExtension(response.body)) ?? 'bin'}`
      }
      return ingest(auth, { bytes: response.body, fileName, folderId: request.folderId ?? null }, ctx)
    },

    async update(auth, id, request, ctx) {
      requireUpload(auth)
      await inTransaction(db, async (tx) => {
        const row = await findMedia(tx, id, { forUpdate: true })
        if (row === undefined || !canRead(auth, row)) {
          throw new NotFoundError()
        }
        if (!canEdit(auth, row)) {
          throw new ForbiddenError()
        }
        const folderId = request.folderId === undefined ? undefined : await checkFolder(tx, request.folderId)
        await updateMedia(
          tx,
          id,
          {
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(request.alt === undefined ? {} : { alt: request.alt }),
            ...(request.caption === undefined ? {} : { caption: request.caption }),
            ...(request.description === undefined ? {} : { description: request.description }),
            ...(request.visibility === undefined ? {} : { visibility: request.visibility }),
            ...(folderId === undefined ? {} : { folderId }),
          },
          clock(),
        )
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media.updated',
          objectType: 'media',
          objectId: id,
          newValue: { fields: Object.keys(request).sort() },
        })
      })
      return itemOf(auth, id)
    },

    async remove(auth, id, ctx) {
      requireUpload(auth)
      const keys = await inTransaction(db, async (tx) => {
        const row = await findMedia(tx, id, { forUpdate: true })
        if (row === undefined || !canRead(auth, row)) {
          throw new NotFoundError()
        }
        if (!canDelete(auth, row)) {
          throw new ForbiddenError()
        }
        await deleteMedia(tx, id)
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media.deleted',
          objectType: 'media',
          objectId: id,
          oldValue: { fileName: row.fileName, mime: row.mime },
        })
        return [row.storageKey, ...variantKeys(row.variants)]
      })
      await removeFiles(keys)
    },

    async replace(auth, id, input, ctx) {
      requireUpload(auth)
      const current = await findMedia(db, id)
      if (current === undefined || !canRead(auth, current)) {
        throw new NotFoundError()
      }
      if (!canEdit(auth, current)) {
        throw new ForbiddenError()
      }
      // A replacement waits for the worker: an edit still pending would otherwise be applied to the new file.
      if (current.processing === 'pending') {
        throw new AppError(409, 'media_busy', 'The image is still being processed')
      }
      const { detection, width, height, settings } = await check(auth, input)
      const now = clock()
      const key = originalKey(input.fileName, detection.ext, now, settings.uploads_use_yearmonth_folders)
      await storage.put(key, input.bytes)
      const resizable = RESIZABLE_MIMES.has(detection.mime)
      let old: string[]
      try {
        old = await inTransaction(db, async (tx) => {
          const row = await findMedia(tx, id, { forUpdate: true })
          if (row === undefined) {
            throw new NotFoundError()
          }
          if (row.processing === 'pending') {
            throw new AppError(409, 'media_busy', 'The image is still being processed')
          }
          await updateMedia(
            tx,
            id,
            {
              mime: detection.mime,
              size: input.bytes.length,
              width,
              height,
              sha256: createHash('sha256').update(input.bytes).digest('hex'),
              storageKey: key,
              fileName: input.fileName.split(/[\\/]/).pop()?.slice(0, 255) ?? '',
              variants: { sizes: {} },
              processing: resizable ? 'pending' : 'ready',
              processingError: null,
              processingAttempts: 0,
            },
            now,
          )
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'media.replaced',
            objectType: 'media',
            objectId: id,
            newValue: { mime: detection.mime, size: input.bytes.length },
          })
          return [row.storageKey, ...variantKeys(row.variants)]
        })
      } catch (err) {
        await removeFiles([key])
        throw err
      }
      await removeFiles(old)
      if (resizable) {
        await queue({ kind: 'process', mediaId: id })
      }
      return itemOf(auth, id)
    },

    async edit(auth, id, request, ctx) {
      requireUpload(auth)
      await inTransaction(db, async (tx) => {
        const row = await findMedia(tx, id, { forUpdate: true })
        if (row === undefined || !canRead(auth, row)) {
          throw new NotFoundError()
        }
        if (!canEdit(auth, row)) {
          throw new ForbiddenError()
        }
        if (!RESIZABLE_MIMES.has(row.mime)) {
          throw new AppError(400, 'not_editable', 'Only images can be edited')
        }
        if (row.processing === 'pending') {
          throw new AppError(409, 'media_busy', 'The image is still being processed')
        }
        const shown = shownVariant(row)
        editedSize(shown.width ?? row.width ?? 1, shown.height ?? row.height ?? 1, request.operations)
        await updateMedia(tx, id, { processing: 'pending', processingError: null, processingAttempts: 0 }, clock())
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media.edited',
          objectType: 'media',
          objectId: id,
          newValue: { operations: request.operations.map((step) => step.op) },
        })
      })
      await queue({ kind: 'edit', mediaId: id, operations: request.operations })
      return itemOf(auth, id)
    },

    async regenerate(auth, request, ctx) {
      if (!has(auth, 'manage_options')) {
        throw new ForbiddenError()
      }
      const ids = await inTransaction(db, async (tx) => {
        const rows = await listMediaPage(
          tx,
          {
            search: undefined,
            mimes: [...RESIZABLE_MIMES],
            month: undefined,
            folder: undefined,
            uploadedBy: undefined,
            ids: request.ids,
            accountId: auth.account.id,
            readPrivate: true,
            timeZone: 'UTC',
          },
          'date',
          'asc',
          100_000,
          0,
        )
        const now = clock()
        for (const row of rows) {
          await updateMedia(tx, row.id, { processing: 'pending', processingError: null, processingAttempts: 0 }, now)
        }
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media.regenerate',
          objectType: 'media',
          newValue: { count: rows.length },
        })
        return rows.map((row) => row.id)
      })
      for (const id of ids) {
        await queue({ kind: 'regenerate', mediaId: id })
      }
      return { queued: ids.length }
    },

    async openPublic(key) {
      const row = await findMediaByKey(db, key)
      if (row?.visibility !== 'public') {
        return undefined
      }
      return open(row, key, key === row.storageKey).catch(() => undefined)
    },

    async openFile(auth, id, which) {
      requireUpload(auth)
      const row = await findMedia(db, id)
      if (row === undefined || !canRead(auth, row)) {
        throw new NotFoundError()
      }
      if (which === 'original') {
        return open(row, row.storageKey, true)
      }
      if (which === undefined) {
        const shown = shownVariant(row)
        return open(row, shown.key, shown.key === row.storageKey)
      }
      const variants = MediaVariantsData.parse(row.variants)
      const size = which === 'scaled' ? variants.scaled : which === 'edited' ? variants.edited : variants.sizes[which]
      if (size === undefined) {
        throw new NotFoundError()
      }
      return open(row, size.key, false)
    },

    async contentRefs(actor, ids) {
      const refs: ContentMediaRef[] = []
      for (const id of [...new Set(ids)]) {
        const row = await findMedia(db, id)
        if (
          row === undefined ||
          (row.visibility === 'private' && row.uploadedBy !== actor.id && !actor.capabilities.has('read_private_posts'))
        ) {
          continue
        }
        const shown = shownVariant(row)
        refs.push({
          id: row.id,
          url: urlOf(row, shown.key, 'shown'),
          width: shown.width,
          height: shown.height,
          alt: row.alt,
          mime: row.mime,
          sizes: Object.entries(row.variants.sizes)
            .map(([name, size]) => ({ name, width: size.width, height: size.height, url: urlOf(row, size.key, name) }))
            .sort((a, b) => a.width - b.width),
        })
      }
      return refs
    },

    async idsForUrls(urls) {
      const found = new Map<string, string>()
      for (const url of urls) {
        const path = url.startsWith(options.publicOrigin) ? url.slice(options.publicOrigin.length) : url
        if (!path.startsWith('/uploads/')) {
          continue
        }
        const row = await findMediaByKey(db, path.slice('/uploads/'.length).split(/[?#]/)[0] ?? '')
        if (row !== undefined) {
          found.set(url, row.id)
        }
      }
      return found
    },

    folders: folderList,

    async createFolder(auth, request, ctx) {
      requireUpload(auth)
      await inTransaction(db, async (tx) => {
        await lockFolders(tx)
        const parentId = await checkFolder(tx, request.parentId)
        if (await folderNameTaken(tx, parentId, request.name, null)) {
          throw new AppError(409, 'folder_exists', 'A folder with this name already exists here')
        }
        const id = await insertFolder(tx, request.name, parentId, clock())
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media_folder.created',
          objectType: 'media_folder',
          objectId: id,
          newValue: { name: request.name },
        })
      })
      return folderList(auth)
    },

    async updateFolder(auth, id, request, ctx) {
      requireOrganize(auth)
      await inTransaction(db, async (tx) => {
        await lockFolders(tx)
        const folder = await findFolder(tx, id)
        if (folder === undefined) {
          throw new NotFoundError()
        }
        const parentId = request.parentId === undefined ? folder.parentId : await checkFolder(tx, request.parentId)
        if (parentId !== null && (parentId === id || (await folderAncestorIds(tx, parentId)).includes(id))) {
          throw new AppError(400, 'invalid_folder', 'A folder cannot be put inside itself')
        }
        const name = request.name ?? folder.name
        if (await folderNameTaken(tx, parentId, name, id)) {
          throw new AppError(409, 'folder_exists', 'A folder with this name already exists here')
        }
        await updateFolder(tx, id, { name, parentId }, clock())
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media_folder.updated',
          objectType: 'media_folder',
          objectId: id,
        })
      })
      return folderList(auth)
    },

    async deleteFolder(auth, id, ctx) {
      requireOrganize(auth)
      await inTransaction(db, async (tx) => {
        const folder = await findFolder(tx, id)
        if (folder === undefined) {
          throw new NotFoundError()
        }
        await deleteFolder(tx, id)
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'media_folder.deleted',
          objectType: 'media_folder',
          objectId: id,
          oldValue: { name: folder.name },
        })
      })
    },

    settings: mediaSettings,

    async updateSettings(auth, request, ctx) {
      if (!has(auth, 'manage_options')) {
        throw new ForbiddenError()
      }
      if (request.upload_max_size_mb !== undefined && request.upload_max_size_mb > options.uploadCapMb) {
        throw new AppError(400, 'above_upload_cap', 'The upload limit cannot be set above the cap in .env')
      }
      await inTransaction(db, async (tx) => {
        await writeSettings(tx, request)
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'settings.updated',
          objectType: 'settings',
          objectId: 'media',
          newValue: { keys: Object.keys(request).sort() },
        })
      })
      return mediaSettings(auth)
    },
  }
}
