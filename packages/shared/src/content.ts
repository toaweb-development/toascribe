import { z } from 'zod'

import { ApiError } from './errors.ts'
import { CONTENT_STATUS_BEFORE_TRASH, CommentStatus, ContentStatus, ContentStatusBeforeTrash } from './values.ts'

// The content API (M1.1; PLAN «API-endepunktkart», «Innhold»): posts and pages in `content`, their authors in `content_author`.
// Every route is under /api/v1/content. Who may do what follows WordPress' `map_meta_cap()` for `edit_post`, `delete_post`,
// `publish_posts` and `read_post`, with the type's own capabilities (`edit_pages` for a page, `edit_posts` for a post).

const isoDate = z.iso.datetime({ offset: true })

/** The content types of M1.1. Types made in admin or in code (K-094) come in phase 2. */
export const CONTENT_TYPES = ['post', 'page'] as const
export const ContentTypeKey = z.enum(CONTENT_TYPES)
export type ContentTypeKey = z.infer<typeof ContentTypeKey>

/** The statuses a request may set. `trash` is reached through `/trash` and left through `/restore`, never set directly. */
export const SETTABLE_CONTENT_STATUS = CONTENT_STATUS_BEFORE_TRASH
export const SettableContentStatus = ContentStatusBeforeTrash
export type SettableContentStatus = ContentStatusBeforeTrash

/** The statuses that need the type's publish capability (WordPress: `publish_posts` also for a private post). */
export const PUBLISHING_STATUSES: readonly SettableContentStatus[] = ['publish', 'future', 'private']

/** WordPress' «Synlighet»: public, private (the status) or password protected (a password is set). */
export const CONTENT_VISIBILITY = ['public', 'private', 'password'] as const
export const ContentVisibility = z.enum(CONTENT_VISIBILITY)
export type ContentVisibility = z.infer<typeof ContentVisibility>

/** The list views above the table (WordPress' edit.php): «Alle» is every status but the trash. */
export const CONTENT_LIST_STATUS = ['all', ...CONTENT_STATUS_BEFORE_TRASH, 'trash'] as const
export const ContentListStatus = z.enum(CONTENT_LIST_STATUS)
export type ContentListStatus = z.infer<typeof ContentListStatus>

/**
 * The orders a list can have. `date` is the date the list shows: the publish date when there is one, otherwise the last change
 * (WordPress' `post_date`, which floats with each save until a date is set). `menu_order` is the order of pages (then title).
 */
export const CONTENT_ORDER_BY = ['date', 'title', 'modified', 'menu_order'] as const
export const ContentOrderBy = z.enum(CONTENT_ORDER_BY)
export type ContentOrderBy = z.infer<typeof ContentOrderBy>

export const CONTENT_DEFAULT_PER_PAGE = 20
export const CONTENT_MAX_PER_PAGE = 100
export const CONTENT_SEARCH_MAX_LENGTH = 200
export const CONTENT_TITLE_MAX_LENGTH = 1000
export const CONTENT_EXCERPT_MAX_LENGTH = 10_000
/** WordPress' post_password is varchar(255). */
export const CONTENT_PASSWORD_MAX_LENGTH = 255
/** The most authors one item can have (K-066). */
export const CONTENT_MAX_AUTHORS = 20
/** The most items one bulk request names. */
export const CONTENT_BULK_MAX_ITEMS = 200
/** The most blocks at the top level of a document (the full check, with nesting, is in @toascribe/blocks). */
export const CONTENT_MAX_TOP_LEVEL_BLOCKS = 5000

/** A month of the date filter: `YYYY-MM`, in the site's time zone. */
export const ContentMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export type ContentMonth = z.infer<typeof ContentMonth>

/** A page template slug (K-068); the theme decides which exist (M1.4). */
export const ContentTemplate = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/)

/**
 * GET /content. `type` is required. `status` is a view; `all` (the default) is every status but `trash`. `author` is an account
 * id (the «Mine» view passes the signed-in account's). `search` matches title, excerpt and the text of the blocks (full text, and the
 * title as a substring); an empty one is none. `month` filters on the list's date in the site's time zone.
 *
 * Pages without a search and in `menu_order` (their default) come as a tree: each parent before its children, in order, with
 * `depth`. `page` and `per_page` then cut the flattened tree.
 */
export const ContentListQuery = z.strictObject({
  type: ContentTypeKey,
  status: ContentListStatus.default('all'),
  author: z.uuid().optional(),
  search: z.string().trim().max(CONTENT_SEARCH_MAX_LENGTH).optional(),
  month: ContentMonth.optional(),
  orderby: ContentOrderBy.optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  per_page: z.coerce.number().int().min(1).max(CONTENT_MAX_PER_PAGE).default(CONTENT_DEFAULT_PER_PAGE),
})
export type ContentListQuery = z.infer<typeof ContentListQuery>
export type ContentListQueryInput = z.input<typeof ContentListQuery>

/** An author of an item, in order. */
export const ContentAuthorRef = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
})
export type ContentAuthorRef = z.infer<typeof ContentAuthorRef>

/** What the signed-in account may do with an item, so the admin draws only the actions that will work. */
export const ContentPermissions = z.object({
  /** WordPress' `edit_post`: change it, quick edit it. */
  edit: z.boolean(),
  /** WordPress' `delete_post`: trash it, restore it, delete it for good. */
  delete: z.boolean(),
  /** The type's `publish_posts` / `publish_pages`: publish, schedule or make it private. */
  publish: z.boolean(),
  /** May set the authors (`edit_others_*`), and sticky on a post (`edit_others_posts` and `publish_posts`). */
  editOthers: z.boolean(),
})
export type ContentPermissions = z.infer<typeof ContentPermissions>

/** The fields an item has in a list and in its own answer. */
const contentFields = {
  id: z.uuid(),
  /** The number of the short link (K-065). */
  shortId: z.int().min(1),
  /** `/?p=<shortId>`, a path on the site. The site answers it from M1.4. */
  shortLink: z.string(),
  type: ContentTypeKey,
  locale: z.string(),
  title: z.string(),
  slug: z.string(),
  status: ContentStatus,
  /** Set while the item is in the trash: what «Gjenopprett» goes back to. */
  statusBeforeTrash: ContentStatusBeforeTrash.nullable(),
  visibility: ContentVisibility,
  /** «Fest øverst på forsiden» (K-069). Posts only; always false for a page. */
  sticky: z.boolean(),
  commentStatus: CommentStatus,
  parentId: z.uuid().nullable(),
  menuOrder: z.int(),
  template: z.string().nullable(),
  publishedAt: isoDate.nullable(),
  unpublishAt: isoDate.nullable(),
  createdAt: isoDate,
  modifiedAt: isoDate,
  authors: z.array(ContentAuthorRef),
  can: ContentPermissions,
}

export const ContentListItem = z.object({
  ...contentFields,
  /** 0 at the top. In a page tree, the number of ancestors shown above it («— » for each in the admin). */
  depth: z.int().min(0),
})
export type ContentListItem = z.infer<typeof ContentListItem>

/** The views' counts. They ignore search, author, month and page. A private item of someone else counts only for `read_private_*`. */
export const ContentCounts = z.object({
  all: z.int().min(0),
  mine: z.int().min(0),
  publish: z.int().min(0),
  draft: z.int().min(0),
  pending: z.int().min(0),
  future: z.int().min(0),
  private: z.int().min(0),
  trash: z.int().min(0),
})
export type ContentCounts = z.infer<typeof ContentCounts>

export const ContentListResponse = z.object({
  items: z.array(ContentListItem),
  /** Matching items over all pages (also in the `X-Total-Count` header). */
  total: z.int().min(0),
  /** Also in the `X-Total-Pages` header. */
  totalPages: z.int().min(0),
  page: z.int().min(1),
  perPage: z.int().min(1),
  counts: ContentCounts,
  /** The months that have items of this type the account can see, newest first: the date filter's choices. */
  months: z.array(ContentMonth),
  /** The site's time zone, as `Intl.DateTimeFormat` takes it (`Europe/Oslo`, or an offset such as `+01:00`): dates are shown in it. */
  timeZone: z.string(),
})
export type ContentListResponse = z.infer<typeof ContentListResponse>

/**
 * One item with everything the editor needs. `blocks` is the stored block tree; until the data migration of M1.3, the items of the
 * install hold WordPress' parsed blocks (`blocksFormat: legacy`), which the editor shows but cannot change.
 */
// `blocks` is not the recursive `Blocks` (z.json()): the OpenAPI generator cannot walk a recursive schema.
export const ContentItem = z.object({
  ...contentFields,
  excerpt: z.string(),
  blocks: z.array(z.record(z.string(), z.unknown())),
  blocksFormat: z.enum(['blocks', 'legacy']),
})
export type ContentItem = z.infer<typeof ContentItem>

export const ContentIdParams = z.object({ id: z.uuid() })
export type ContentIdParams = z.infer<typeof ContentIdParams>

/** The fields a request may set. A field left out keeps its value (or its default on create). */
const writableFields = {
  title: z.string().max(CONTENT_TITLE_MAX_LENGTH),
  /** Cleaned like WordPress' `sanitize_title` and made unique; empty makes one from the title. */
  slug: z.string().max(1000),
  excerpt: z.string().max(CONTENT_EXCERPT_MAX_LENGTH),
  status: SettableContentStatus,
  /** The publish date. `publish` with a date in the future becomes `future`, `future` with a date that has passed becomes `publish`. */
  publishedAt: isoDate.nullable(),
  /** When a published item goes back to draft (K-064). Must be after the publish date. */
  unpublishAt: isoDate.nullable(),
  /** The post password (K-067): a new one replaces the old, `null` removes it. It is hashed; it can be replaced, never read. */
  password: z.string().min(1).max(CONTENT_PASSWORD_MAX_LENGTH).nullable(),
  sticky: z.boolean(),
  commentStatus: CommentStatus,
  /** Pages only (K-068): the parent page, in the same language, never the item itself or one of its children. */
  parentId: z.uuid().nullable(),
  menuOrder: z.int().min(-1_000_000).max(1_000_000),
  template: ContentTemplate.nullable(),
  /** Account ids in order (K-066). Someone else than yourself needs `edit_others_*`; each must be able to edit the type. */
  authors: z
    .array(z.uuid())
    .min(1)
    .max(CONTENT_MAX_AUTHORS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each author may be named once' }),
  /** The block tree, checked against each block's block.json on the server. */
  blocks: z.array(z.unknown()).max(CONTENT_MAX_TOP_LEVEL_BLOCKS),
}

/** POST /content. Everything but `type` may be left out: a new draft by the signed-in account. */
export const CreateContentRequest = z
  .strictObject({
    type: ContentTypeKey,
    ...writableFields,
  })
  .partial({
    title: true,
    slug: true,
    excerpt: true,
    status: true,
    publishedAt: true,
    unpublishAt: true,
    password: true,
    sticky: true,
    commentStatus: true,
    parentId: true,
    menuOrder: true,
    template: true,
    authors: true,
    blocks: true,
  })
export type CreateContentRequest = z.infer<typeof CreateContentRequest>

/** PATCH /content/{id}: any of the fields, at least one. A trashed item cannot be changed; restore it first. */
export const UpdateContentRequest = z
  .strictObject(writableFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field' })
export type UpdateContentRequest = z.infer<typeof UpdateContentRequest>

/** «Rediger» in the bulk actions (WordPress' bulk edit): what is sent is set on every item; what is left out is not touched. */
export const ContentBulkChanges = z
  .strictObject({
    status: SettableContentStatus,
    /** Replaces the authors with this one account. */
    authorId: z.uuid(),
    commentStatus: CommentStatus,
    sticky: z.boolean(),
    parentId: z.uuid().nullable(),
    template: ContentTemplate.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one change' })
export type ContentBulkChanges = z.infer<typeof ContentBulkChanges>

const bulkIds = z
  .array(z.uuid())
  .min(1)
  .max(CONTENT_BULK_MAX_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Each item may be named once' })

/**
 * POST /content/bulk. `trash`, `restore`, `delete` (permanently, trashed items only) and `edit` act on the items named;
 * `empty_trash` deletes every trashed item of the type the account may delete («Tøm papirkurven»).
 */
export const ContentBulkRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('trash'), ids: bulkIds }),
  z.strictObject({ action: z.literal('restore'), ids: bulkIds }),
  z.strictObject({ action: z.literal('delete'), ids: bulkIds }),
  z.strictObject({ action: z.literal('edit'), ids: bulkIds, changes: ContentBulkChanges }),
  z.strictObject({ action: z.literal('empty_trash'), type: ContentTypeKey }),
])
export type ContentBulkRequest = z.infer<typeof ContentBulkRequest>

/**
 * Why an item was left as it was:
 * - `not_found`: no such item, or one the account cannot see.
 * - `forbidden`: the account may not do this to it (someone else's, published, or no publish right for the new status).
 * - `trashed`: it is in the trash (edit, trash).
 * - `not_trashed`: it is not in the trash (restore, delete).
 * - `invalid`: the change does not fit it (sticky on a page, a parent for a post or a parent that is its own child, an author who
 *   cannot edit the type, a schedule without a future date).
 */
export const CONTENT_BULK_SKIP_REASONS = ['not_found', 'forbidden', 'trashed', 'not_trashed', 'invalid'] as const
export const ContentBulkSkipReason = z.enum(CONTENT_BULK_SKIP_REASONS)
export type ContentBulkSkipReason = z.infer<typeof ContentBulkSkipReason>

export const ContentBulkResponse = z.object({
  /** Items changed (or deleted), in request order. */
  changed: z.array(z.uuid()),
  /** Items that already were as asked: nothing was written. */
  unchanged: z.array(z.uuid()),
  skipped: z.array(z.object({ id: z.uuid(), reason: ContentBulkSkipReason })),
})
export type ContentBulkResponse = z.infer<typeof ContentBulkResponse>

/** GET /content/authors: who can be an author of the type (WordPress' author dropdown). */
export const ContentAuthorsQuery = z.strictObject({ type: ContentTypeKey })
export type ContentAuthorsQuery = z.infer<typeof ContentAuthorsQuery>

export const ContentAuthorsResponse = z.object({ authors: z.array(ContentAuthorRef) })
export type ContentAuthorsResponse = z.infer<typeof ContentAuthorsResponse>

/** The short link of an item (K-065): a path on the site. */
export function shortLinkOf(shortId: number): string {
  return `/?p=${String(shortId)}`
}

/** One problem with a block document, at a path from the top of the document (indexes, `children`, `attrs` and keys). */
export const BlockIssue = z.object({
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  code: z.string(),
  message: z.string(),
})
export type BlockIssue = z.infer<typeof BlockIssue>

/** The most issues one answer lists. */
export const MAX_BLOCK_ISSUES = 100

/** 400 `invalid_blocks`: the common error, with the issues. */
export const InvalidBlocksResponse = ApiError.extend({ issues: z.array(BlockIssue).max(MAX_BLOCK_ISSUES) })
export type InvalidBlocksResponse = z.infer<typeof InvalidBlocksResponse>

/**
 * The PostgreSQL text search configuration for a locale (DATAMODEL «Full-text search»; K-240 is still open): `norwegian` for
 * Norwegian (both written forms), `english` for English, `simple` otherwise. A vector and the query that searches it must use the same.
 */
export function textSearchConfig(locale: string): 'norwegian' | 'english' | 'simple' {
  const language = locale.toLowerCase().split(/[-_]/)[0]
  if (language === 'nb' || language === 'nn' || language === 'no') {
    return 'norwegian'
  }
  return language === 'en' ? 'english' : 'simple'
}
