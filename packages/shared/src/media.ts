import { z } from 'zod'

import { ContentTypeKey } from './content.ts'
import { MediaGroup, MediaProcessing, MediaVisibility } from './values.ts'

// The media library (M1.2; PLAN «Mediebiblioteket», K-110 to K-125). Files are uploaded through the api (`POST /media`, multipart)
// and the worker makes the sizes. Who may do what follows WordPress' attachments: `upload_files` to upload and to see the library;
// a file is its uploader's own, and changing or deleting someone else's needs `edit_others_posts` / `delete_others_posts`. A private
// file is served only through the api to its uploader and to `read_private_posts`.

const isoDate = z.iso.datetime({ offset: true })

export const MEDIA_TITLE_MAX_LENGTH = 1000
export const MEDIA_TEXT_MAX_LENGTH = 10_000
export const MEDIA_DEFAULT_PER_PAGE = 40
export const MEDIA_MAX_PER_PAGE = 100
export const MEDIA_FOLDER_NAME_MAX_LENGTH = 200

/** One generated file: a size, the `-scaled` copy or an edited image. Always WebP. */
export const MediaVariant = z.object({
  key: z.string(),
  width: z.int().min(1),
  height: z.int().min(1),
  size: z.int().min(0),
  mime: z.string(),
})
export type MediaVariant = z.infer<typeof MediaVariant>

/** One step of «Rediger bilde» (K-114), applied in order. A crop is in the pixels of the image as it is shown (after earlier steps). */
export const MediaEditOperation = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('crop'),
    x: z.int().min(0),
    y: z.int().min(0),
    width: z.int().min(1),
    height: z.int().min(1),
  }),
  z.strictObject({ op: z.literal('rotate'), degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
  z.strictObject({ op: z.literal('flip'), direction: z.enum(['horizontal', 'vertical']) }),
  z.strictObject({ op: z.literal('scale'), width: z.int().min(1).max(20_000) }),
])
export type MediaEditOperation = z.infer<typeof MediaEditOperation>

/**
 * media.variants, as the worker writes it. `sizes` are cut from the edited image when there is one, otherwise from the original; the
 * original file itself is never changed. `scaled` is WordPress' `-scaled` copy of an original over 2560 pixels.
 */
export const MediaVariantsData = z.object({
  sizes: z.record(z.string(), MediaVariant).default({}),
  scaled: MediaVariant.optional(),
  edited: MediaVariant.extend({ operations: z.array(MediaEditOperation), at: isoDate }).optional(),
})
export type MediaVariantsData = z.infer<typeof MediaVariantsData>

/** A file as the library lists it. */
export const MediaSizeRef = z.object({
  name: z.string(),
  width: z.int().min(1),
  height: z.int().min(1),
  url: z.string(),
})
export type MediaSizeRef = z.infer<typeof MediaSizeRef>

export const MediaItem = z.object({
  id: z.uuid(),
  title: z.string(),
  alt: z.string(),
  caption: z.string(),
  description: z.string(),
  mime: z.string(),
  group: MediaGroup,
  fileName: z.string(),
  /** Bytes of the original. */
  size: z.int().min(0),
  /** Of the image as it is shown (after an edit); null for files without dimensions. */
  width: z.int().nullable(),
  height: z.int().nullable(),
  visibility: MediaVisibility,
  folderId: z.uuid().nullable(),
  uploadedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  attachedTo: z.uuid().nullable(),
  processing: MediaProcessing,
  /** The address of the file as it is shown: the edited or `-scaled` image, or the original. Public files under /uploads/, private ones through the api. */
  url: z.string(),
  /** The original as uploaded. */
  originalUrl: z.string(),
  /** The generated sizes, smallest first (for srcset). */
  sizes: z.array(MediaSizeRef),
  createdAt: isoDate,
  modifiedAt: isoDate,
  can: z.object({ edit: z.boolean(), delete: z.boolean() }),
})
export type MediaItem = z.infer<typeof MediaItem>

/** «Brukes på» (K-122): the content whose blocks use the file. */
export const MediaUsage = z.object({ id: z.uuid(), type: ContentTypeKey, title: z.string(), status: z.string() })
export type MediaUsage = z.infer<typeof MediaUsage>

/**
 * «Brukes på» (K-122): the content the asker may read, by title, and how many more items use the file. Their titles are not
 * shown: a private post of someone else is not named to everyone who can see the file.
 */
export const MediaDetail = MediaItem.extend({ usedBy: z.array(MediaUsage), usedByOthers: z.int().min(0) })
export type MediaDetail = z.infer<typeof MediaDetail>

export const MediaIdParams = z.object({ id: z.uuid() })

/** GET /media. `folder` is a folder id or `none` (the top); `mine` is the signed-in account's uploads. */
export const MediaListQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  group: MediaGroup.optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  folder: z.union([z.uuid(), z.literal('none')]).optional(),
  mine: z.enum(['true']).optional(),
  /** Specific files (the editor asks for the images of a document). At most 100. */
  ids: z
    .string()
    .regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,99}$/i)
    .optional(),
  orderby: z.enum(['date', 'title']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  per_page: z.coerce.number().int().min(1).max(MEDIA_MAX_PER_PAGE).default(MEDIA_DEFAULT_PER_PAGE),
})
export type MediaListQuery = z.infer<typeof MediaListQuery>
export type MediaListQueryInput = z.input<typeof MediaListQuery>

export const MediaListResponse = z.object({
  items: z.array(MediaItem),
  total: z.int().min(0),
  totalPages: z.int().min(0),
  page: z.int().min(1),
  perPage: z.int().min(1),
  /** The months with files, newest first (the date filter). */
  months: z.array(z.string()),
  /** What the signed-in account may upload (K-117): the largest file in bytes and the extensions. */
  upload: z.object({ maxBytes: z.int().min(1), extensions: z.array(z.string()) }),
})
export type MediaListResponse = z.infer<typeof MediaListResponse>

/** PATCH /media/{id}. */
export const UpdateMediaRequest = z
  .strictObject({
    title: z.string().max(MEDIA_TITLE_MAX_LENGTH),
    alt: z.string().max(MEDIA_TITLE_MAX_LENGTH),
    caption: z.string().max(MEDIA_TEXT_MAX_LENGTH),
    description: z.string().max(MEDIA_TEXT_MAX_LENGTH),
    visibility: MediaVisibility,
    folderId: z.uuid().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateMediaRequest = z.infer<typeof UpdateMediaRequest>

/** POST /media/{id}/edit (K-114): the steps, applied to the image as it is shown; the original is kept. */
export const MediaEditRequest = z.strictObject({ operations: z.array(MediaEditOperation).min(1).max(20) })
export type MediaEditRequest = z.infer<typeof MediaEditRequest>

/** POST /media/from-url: «Last opp fra URL», fetched with safeFetch into the library. */
export const MediaFromUrlRequest = z.strictObject({
  url: z.url({ protocol: /^https?$/ }).max(2048),
  folderId: z.uuid().nullable().optional(),
})
export type MediaFromUrlRequest = z.infer<typeof MediaFromUrlRequest>

/** POST /media/regenerate (K-116): the sizes of these images, or of every image when `ids` is left out. */
export const MediaRegenerateRequest = z.strictObject({ ids: z.array(z.uuid()).min(1).max(1000).optional() })
export type MediaRegenerateRequest = z.infer<typeof MediaRegenerateRequest>

export const MediaRegenerateResponse = z.object({ queued: z.int().min(0) })
export type MediaRegenerateResponse = z.infer<typeof MediaRegenerateResponse>

/** A folder of the library (K-119). */
export const MediaFolderItem = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  depth: z.int().min(0),
  count: z.int().min(0),
})
export type MediaFolderItem = z.infer<typeof MediaFolderItem>

export const MediaFolderListResponse = z.object({ folders: z.array(MediaFolderItem) })
export type MediaFolderListResponse = z.infer<typeof MediaFolderListResponse>

export const CreateMediaFolderRequest = z.strictObject({
  name: z.string().trim().min(1).max(MEDIA_FOLDER_NAME_MAX_LENGTH),
  parentId: z.uuid().nullable().optional(),
})
export type CreateMediaFolderRequest = z.infer<typeof CreateMediaFolderRequest>

export const UpdateMediaFolderRequest = z
  .strictObject({
    name: z.string().trim().min(1).max(MEDIA_FOLDER_NAME_MAX_LENGTH),
    parentId: z.uuid().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateMediaFolderRequest = z.infer<typeof UpdateMediaFolderRequest>

/** The worker's media jobs (typescript §11: one schema, checked when sent and when taken). */
export const MEDIA_QUEUE = 'media.process'
export const MediaJob = z.discriminatedUnion('kind', [
  /** A new or replaced file: make the sizes (and `-scaled`). */
  z.strictObject({ kind: z.literal('process'), mediaId: z.uuid() }),
  /** «Lag bildestørrelser på nytt»: the sizes again, from the edited image or the original. */
  z.strictObject({ kind: z.literal('regenerate'), mediaId: z.uuid() }),
  /** «Rediger bilde»: a new edited image from these steps, and its sizes. */
  z.strictObject({
    kind: z.literal('edit'),
    mediaId: z.uuid(),
    operations: z.array(MediaEditOperation).min(1).max(20),
  }),
])
export type MediaJob = z.infer<typeof MediaJob>

/** How a media job is queued: two more tries a minute apart, and given up after ten minutes. */
export const MEDIA_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  expireInSeconds: 600,
  retentionSeconds: 7 * 24 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
} as const

/** «Innstillinger → Media» (GET/PATCH /settings/media). */
export const MediaSettings = z.object({
  thumbnail_size_w: z.int().min(0).max(10_000),
  thumbnail_size_h: z.int().min(0).max(10_000),
  thumbnail_crop: z.boolean(),
  medium_size_w: z.int().min(0).max(10_000),
  medium_size_h: z.int().min(0).max(10_000),
  large_size_w: z.int().min(0).max(10_000),
  large_size_h: z.int().min(0).max(10_000),
  uploads_use_yearmonth_folders: z.boolean(),
  upload_max_size_mb: z.int().min(1).max(4096),
  image_max_pixels: z.int().min(1_000_000).max(1_000_000_000),
  upload_groups_by_role: z.record(
    z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(64),
    z.array(MediaGroup).max(7),
  ),
})
export type MediaSettings = z.infer<typeof MediaSettings>

export const MediaSettingsResponse = z.object({
  settings: MediaSettings,
  /** The cap from .env (UPLOAD_MAX_SIZE_MB): `upload_max_size_mb` cannot be set above it. */
  uploadMaxSizeCapMb: z.int().min(1),
})
export type MediaSettingsResponse = z.infer<typeof MediaSettingsResponse>

export const UpdateMediaSettingsRequest = MediaSettings.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Send at least one field',
})
export type UpdateMediaSettingsRequest = z.infer<typeof UpdateMediaSettingsRequest>
