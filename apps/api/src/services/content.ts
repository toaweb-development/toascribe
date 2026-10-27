// The content service (M1.1): posts and pages as WordPress' edit.php, post.php and the bulk actions handle them. Who may do what is
// lib/content-access.ts; this file is the order of the checks, the status rules, the slug and the search vector.
//
// The status rules (K-061, K-063, K-064, K-070):
// - A request sets draft, pending, publish, future or private. `trash` is reached through trash() and left through restore(); a
//   trashed item cannot be changed in any other way.
// - publish, future and private need the type's publish capability; a contributor can send for review (`pending`), not publish.
//   Moving the publish date of a published or scheduled item, or setting an unpublish date, needs it too.
// - `publish` with a date in the future becomes `future`; `future` with a date that has passed becomes `publish`, and `future`
//   without a date is refused. `publish` and `private` without a date get the time of the save.
// - The worker publishes `future` items when their time comes and takes published items back to `draft` at `unpublish_at`.
import { randomUUID } from 'node:crypto'

import { hashPassword } from '@toascribe/auth'
import {
  documentLinkRefs,
  documentMediaRefs,
  documentText,
  legacyImageUrls,
  migrateDocument,
  permissionIssues,
  validateDocument,
} from '@toascribe/blocks'
import type { Block } from '@toascribe/blocks'
import { deleteContentPermanently, legacyBlocksText, uniqueContentSlug } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import {
  ContentSeo,
  CoreSettings,
  PUBLISHING_STATUSES,
  sanitizeTitle,
  shortLinkOf,
  textSearchConfig,
  trashedSlug,
  untrashedSlug,
} from '@toascribe/shared'
import type {
  Blocks,
  ContentBulkRequest,
  ContentBulkResponse,
  ContentAuthorsResponse,
  ContentBulkSkipReason,
  ContentCounts,
  ContentItem,
  ContentListItem,
  ContentListQuery,
  ContentListResponse,
  ContentStatus,
  ContentTypeKey,
  ContentVisibility,
  CreateContentRequest,
  SeoRequest,
  SettableContentStatus,
  UpdateContentRequest,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import {
  canDelete,
  canEdit,
  canEditOthersType,
  canEditType,
  canPublishType,
  canRead,
  permissionsFor,
  typeCapabilities,
} from '../lib/content-access.ts'
import type { AccessItem, Actor } from '../lib/content-access.ts'
import { AppError, ForbiddenError, InvalidBlocksError, NotFoundError } from '../lib/errors.ts'
import {
  accountsWithCapability,
  lockPageTree,
  ancestorIds,
  authorsOf,
  capabilitiesOf,
  countByStatus,
  countContent,
  findContent,
  findContentRows,
  findParentCandidate,
  insertContent,
  listContentPage,
  listContentTree,
  listMonths,
  replaceAuthors,
  trashedIds,
  updateContent,
} from '../repositories/content.ts'
import type {
  AuthorRow,
  ContentRow,
  ContentValues,
  ListContext,
  SearchText,
  SiteTimeZone,
  StoredContent,
  TreeNode,
} from '../repositories/content.ts'
import type { Executor } from '../repositories/executor.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'
import {
  ensureTags,
  existingTermIds,
  findTaxonomy,
  itemTermIds,
  lockTaxonomy,
  replaceItemTerms,
  termWithDescendants,
  termsOfContent,
} from '../repositories/terms.ts'
import type { ContentTermRow } from '../repositories/terms.ts'
import type { Auditor, RequestContext } from './support.ts'
import type { MediaService } from './media.ts'
import { replaceLinkRefs, replaceMediaRefs } from '../repositories/media.ts'

export interface ContentService {
  list: (auth: SessionAuth, query: ContentListQuery) => Promise<ContentListResponse>
  /** The views' counts of a type, or undefined when the account may not edit the type (the dashboard leaves it out then). */
  counts: (auth: SessionAuth, type: ContentTypeKey) => Promise<ContentCounts | undefined>
  get: (auth: SessionAuth, id: string) => Promise<ContentItem>
  create: (auth: SessionAuth, request: CreateContentRequest, ctx: RequestContext) => Promise<ContentItem>
  update: (auth: SessionAuth, id: string, request: UpdateContentRequest, ctx: RequestContext) => Promise<ContentItem>
  publish: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<ContentItem>
  trash: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<ContentItem>
  restore: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<ContentItem>
  /** Deletes a trashed item for good. */
  remove: (auth: SessionAuth, id: string, ctx: RequestContext) => Promise<void>
  bulk: (auth: SessionAuth, request: ContentBulkRequest, ctx: RequestContext) => Promise<ContentBulkResponse>
  /** The accounts that can be authors of the type; only for those who may choose authors (`edit_others_*`). */
  authors: (auth: SessionAuth, type: ContentTypeKey) => Promise<ContentAuthorsResponse>
}

const SETTINGS = CoreSettings.pick({
  locale: true,
  default_comment_status: true,
  default_category: true,
  timezone_string: true,
  gmt_offset: true,
})

/** The publishing statuses as a set of the stored status type, for `includes` on a `ContentStatus`. */
const PUBLISHING: ReadonlySet<ContentStatus> = new Set(PUBLISHING_STATUSES)

function actorOf(auth: SessionAuth): Actor {
  return { id: auth.account.id, capabilities: auth.capabilities }
}

function accessOf(row: ContentRow, authors: readonly { id: string }[]): AccessItem {
  return {
    type: row.type,
    status: row.status,
    statusBeforeTrash: row.statusBeforeTrash,
    authorIds: authors.map((author) => author.id),
  }
}

function visibilityOf(row: ContentRow): ContentVisibility {
  if (row.status === 'private') {
    return 'private'
  }
  return row.hasPassword ? 'password' : 'public'
}

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString()
}

const termRef = (entry: ContentTermRow) => ({ id: entry.id, name: entry.name, slug: entry.slug })

function baseFields(
  row: ContentRow,
  authors: readonly AuthorRow[],
  actor: Actor,
  terms: { categories: readonly ContentTermRow[]; tags: readonly ContentTermRow[] } | undefined,
) {
  return {
    id: row.id,
    shortId: row.shortId,
    shortLink: shortLinkOf(row.shortId),
    type: row.type,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    status: row.status,
    statusBeforeTrash: row.statusBeforeTrash,
    visibility: visibilityOf(row),
    sticky: row.type === 'post' && row.sticky,
    commentStatus: row.commentStatus,
    parentId: row.parentId,
    menuOrder: row.menuOrder,
    template: row.template,
    publishedAt: iso(row.publishedAt),
    unpublishAt: iso(row.unpublishAt),
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.modifiedAt.toISOString(),
    authors: authors.map((author) => ({ id: author.id, username: author.username, displayName: author.displayName })),
    categories: (terms?.categories ?? []).map(termRef),
    tags: (terms?.tags ?? []).map(termRef),
    can: permissionsFor(actor, accessOf(row, authors)),
  }
}

/** The words of a stored tree: toascribe blocks through their block.json, WordPress' parsed blocks through their HTML. */
function storedBlocksText(blocks: Blocks): string {
  const checked = validateDocument(blocks)
  return checked.ok ? documentText(checked.blocks) : legacyBlocksText(blocks)
}

function toJson(blocks: readonly Block[]): Blocks {
  // The block tree is plain JSON objects; this drops the readonly types and anything that is not JSON.
  return JSON.parse(JSON.stringify(blocks)) as Blocks
}

/**
 * The status and publish date a save ends with (see the rules at the top). Throws 400 `invalid_schedule` for `future` without a
 * date, and for an unpublish date that is not after the publish date (or after now, for an item without one).
 */
export function resolveSchedule(
  status: SettableContentStatus,
  publishedAt: Date | null,
  unpublishAt: Date | null,
  now: Date,
): { status: SettableContentStatus; publishedAt: Date | null } {
  let resolved = status
  let date = publishedAt
  if (status === 'future') {
    if (date === null) {
      throw new AppError(400, 'invalid_schedule', 'A scheduled item needs a publish date')
    }
    if (date.getTime() <= now.getTime()) {
      resolved = 'publish'
    }
  } else if (status === 'publish') {
    if (date === null) {
      date = now
    } else if (date.getTime() > now.getTime()) {
      resolved = 'future'
    }
  } else if (status === 'private' && date === null) {
    date = now
  }
  if (unpublishAt !== null && unpublishAt.getTime() <= (date ?? now).getTime()) {
    throw new AppError(400, 'invalid_schedule', 'The unpublish date must come after the publish date')
  }
  return { status: resolved, publishedAt: date }
}

/**
 * Whether the slug is still the one the service made from the title (or from the short id): `title` or `title-2`, ... While an
 * item has not been published, such a slug follows the title, as a WordPress draft's slug does.
 */
export function isAutomaticSlug(slug: string, title: string, shortId: number, locale: string): boolean {
  const base = sanitizeTitle(title, String(shortId), locale)
  return slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)))
}

/**
 * The page tree flattened: each parent before its children, siblings in the order given, with the depth. An item whose parent is
 * not in the list starts a tree of its own at depth 0 (WordPress shows such a page at the top of a filtered list).
 */
export function flattenTree(nodes: readonly TreeNode[]): { id: string; depth: number }[] {
  const present = new Set(nodes.map((node) => node.id))
  const children = new Map<string, TreeNode[]>()
  const roots: TreeNode[] = []
  for (const node of nodes) {
    if (node.parentId !== null && present.has(node.parentId) && node.parentId !== node.id) {
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
    } else {
      roots.push(node)
    }
  }
  const flat: { id: string; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (node: TreeNode, depth: number) => {
    if (seen.has(node.id)) {
      return
    }
    seen.add(node.id)
    flat.push({ id: node.id, depth })
    for (const child of children.get(node.id) ?? []) {
      visit(child, depth + 1)
    }
  }
  for (const root of roots) {
    visit(root, 0)
  }
  // A cycle (never written by the service, but the database does not forbid one) would leave items unvisited: show them at the top.
  for (const node of nodes) {
    visit(node, 0)
  }
  return flat
}

function timeZoneOf(settings: { timezone_string: string; gmt_offset: number }): SiteTimeZone {
  return settings.timezone_string === ''
    ? { offsetMinutes: Math.round(settings.gmt_offset * 60) }
    : { name: settings.timezone_string }
}

/** The zone as Intl takes it: the IANA name, or the offset as `+01:00`. */
function intlTimeZone(zone: SiteTimeZone): string {
  if ('name' in zone) {
    return zone.name
  }
  const minutes = Math.abs(zone.offsetMinutes)
  const sign = zone.offsetMinutes < 0 ? '-' : '+'
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return (a === null ? null : a.getTime()) === (b === null ? null : b.getTime())
}

/** Equal values, dates by their time. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : false
  }
  return a === b
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function toDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value)
}

/** The bulk reason for an error one item gave. Anything not listed is a real failure and is thrown on. */
function skipReasonOf(error: AppError): ContentBulkSkipReason | undefined {
  if (error.code === 'content_trashed') return 'trashed'
  if (error.code === 'not_trashed') return 'not_trashed'
  if (error.status === 404) return 'not_found'
  if (error.status === 403) return 'forbidden'
  if (error.status === 400) return 'invalid'
  return undefined
}

/** What a write of one item ended with. */
type Outcome = 'changed' | 'unchanged'

export function createContentService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  /** The media library: the addresses of old image blocks, and the files a document uses. */
  readonly media: Pick<MediaService, 'contentRefs' | 'idsForUrls'>
  readonly onInvalidSetting?: (key: string) => void
}): ContentService {
  const { db, clock, audit, media } = options

  /** A stored or sent tree with every block upgraded to its current version (core/image: an address becomes a media id). */
  async function migrated(blocks: unknown): Promise<unknown> {
    const urls = legacyImageUrls(blocks)
    const ids = urls.length === 0 ? new Map<string, string>() : await media.idsForUrls(urls)
    return migrateDocument(blocks, { mediaIdForUrl: (url) => ids.get(url) }).blocks
  }

  /**
   * Checks a sent tree after upgrading it, and the blocks the account may use there (permissionIssues: custom HTML needs
   * unfiltered_html, «Les mer» belongs in posts) against the tree stored before; the stored form, its text and the media it uses.
   */
  async function checkSent(blocks: readonly unknown[], actor: Actor, contentType: ContentTypeKey, previous: unknown) {
    const upgraded = await migrated(blocks)
    const result = validateDocument(upgraded)
    if (!result.ok) {
      throw new InvalidBlocksError(result.issues.map((issue) => ({ ...issue, path: [...issue.path] })))
    }
    const stored = validateDocument(await migrated(previous))
    const refused = permissionIssues(result.blocks, stored.ok ? stored.blocks : [], {
      capabilities: actor.capabilities,
      contentType,
    })
    if (refused.length > 0) {
      throw new InvalidBlocksError(refused.map((issue) => ({ ...issue, path: [...issue.path] })))
    }
    return {
      stored: toJson(result.blocks),
      text: documentText(result.blocks),
      refs: documentMediaRefs(result.blocks),
      links: documentLinkRefs(result.blocks),
    }
  }

  const settingsOf = (executor: Executor) => readSettings(executor, SETTINGS, options.onInvalidSetting)

  /** A featured or sharing image: an image in the media library that the account may see (a private file of someone else is not). */
  async function checkImage(actor: Actor, id: string | null | undefined): Promise<void> {
    if (id === undefined || id === null) {
      return
    }
    const [ref] = await media.contentRefs(actor, [id])
    if (!ref?.mime.startsWith('image/')) {
      throw new AppError(400, 'invalid_media', 'The image is not in the media library, or not one you may use')
    }
  }

  /**
   * The SEO panel as it is stored: only what has a value (an empty title means «use the item's title»). The image is checked when it
   * is new; the one already stored is kept as it is (like the featured image), so a save never fails on an image someone else hid.
   */
  async function seoOf(actor: Actor, request: SeoRequest, stored?: string): Promise<ContentSeo> {
    if (request.image !== stored) {
      await checkImage(actor, request.image)
    }
    return {
      ...(request.title === undefined || request.title === '' ? {} : { title: request.title }),
      ...(request.description === undefined || request.description === '' ? {} : { description: request.description }),
      ...(request.image === undefined ? {} : { image: request.image }),
      ...(request.noindex === true ? { noindex: true } : {}),
    }
  }

  async function loadItem(executor: Executor, actor: Actor, id: string): Promise<ContentItem> {
    const row = await findContent(executor, id)
    const authors = (await authorsOf(executor, [id])).get(id) ?? []
    if (row === undefined || !canRead(actor, accessOf(row, authors))) {
      throw new NotFoundError()
    }
    const terms = (await termsOfContent(executor, [id])).get(id)
    const blocks = await migrated(row.blocks)
    const checked = validateDocument(blocks)
    const refs = checked.ok ? documentMediaRefs(checked.blocks) : []
    const seo = ContentSeo.catch({}).parse(row.seo)
    const mediaIds = [
      ...refs.map((ref) => ref.mediaId),
      ...(row.featuredMediaId === null ? [] : [row.featuredMediaId]),
      ...(seo.image === undefined ? [] : [seo.image]),
    ]
    return {
      ...baseFields(row, authors, actor, terms),
      excerpt: row.excerpt,
      blocks: checked.ok ? toJson(checked.blocks) : row.blocks,
      blocksFormat: checked.ok ? 'blocks' : 'legacy',
      featuredMediaId: row.featuredMediaId,
      seo,
      media: mediaIds.length === 0 ? [] : await media.contentRefs(actor, mediaIds),
    }
  }

  /** Locks the item and reads it with its authors. 404 when it is not there or the account may not see it. */
  async function lockItem(
    tx: Executor,
    actor: Actor,
    id: string,
  ): Promise<{ row: StoredContent; authors: AuthorRow[]; access: AccessItem }> {
    const row = await findContent(tx, id, { forUpdate: true })
    const authors = (await authorsOf(tx, [id])).get(id) ?? []
    if (row === undefined) {
      throw new NotFoundError()
    }
    const access = accessOf(row, authors)
    if (!canRead(actor, access)) {
      throw new NotFoundError()
    }
    return { row, authors, access }
  }

  /** The authors a request names: each must exist and be able to edit the type (WordPress' author list). */
  async function checkAuthors(executor: Executor, type: ContentTypeKey, ids: readonly string[]): Promise<void> {
    const found = await capabilitiesOf(executor, ids)
    const needed = typeCapabilities(type).edit
    for (const id of ids) {
      if (found.get(id)?.has(needed) !== true) {
        throw new AppError(400, 'invalid_author', 'An author must be an account that can edit this type')
      }
    }
  }

  /** A parent must be a page in the same language, not in the trash, and not the item itself or one below it. */
  async function checkParent(
    executor: Executor,
    item: { id: string | null; type: ContentTypeKey; locale: string },
    parentId: string,
  ): Promise<void> {
    if (item.type !== 'page') {
      throw new AppError(400, 'invalid_parent', 'Only pages have a parent')
    }
    if (item.id !== null) {
      // One change of a page's parent at a time per type and language: two at once (A under B, B under A) would each pass the cycle
      // check against the other's old place.
      await lockPageTree(executor, item.type)
    }
    const parent = await findParentCandidate(executor, parentId)
    if (parent?.type !== item.type || parent.locale !== item.locale || parent.status === 'trash') {
      throw new AppError(400, 'invalid_parent', 'The parent must be a page in the same language, not in the trash')
    }
    if (item.id !== null && (parentId === item.id || (await ancestorIds(executor, parentId)).includes(item.id))) {
      throw new AppError(400, 'invalid_parent', 'A page cannot be its own parent or the parent of its parent')
    }
  }

  function checkSticky(actor: Actor, type: ContentTypeKey): void {
    if (type !== 'post') {
      throw new AppError(400, 'sticky_not_supported', 'Only posts can be sticky')
    }
    // WordPress: stick and unstick need both edit_others_posts and publish_posts.
    if (!canEditOthersType(actor, type) || !canPublishType(actor, type)) {
      throw new AppError(403, 'cannot_stick', 'You may not make posts sticky')
    }
  }

  /** What a save asks of an item's terms: the full lists (create, change) or additions (bulk edit). */
  interface TermRequest {
    readonly categories?: readonly string[] | undefined
    readonly tags?: readonly string[] | undefined
    readonly addCategories?: readonly string[] | undefined
    readonly addTags?: readonly string[] | undefined
  }

  const hasTerms = (request: TermRequest) =>
    request.categories !== undefined ||
    request.tags !== undefined ||
    request.addCategories !== undefined ||
    request.addTags !== undefined

  /**
   * Sets the categories and tags of a post as the request asks, inside the caller's transaction. A post left without a category
   * gets the default one («Ukategorisert»), as WordPress does; new tag names become tags. Returns whether anything changed. Pages
   * have no terms: asking for them is a 400.
   */
  async function applyTerms(
    tx: Executor,
    item: { readonly id: string; readonly type: ContentTypeKey },
    request: TermRequest,
    isNew: boolean,
    now: Date,
  ): Promise<boolean> {
    if (item.type !== 'post') {
      if (hasTerms(request)) {
        throw new AppError(400, 'terms_not_supported', 'Only posts have categories and tags')
      }
      return false
    }
    let changed = false
    const categories = await findTaxonomy(tx, 'category')
    if (
      categories !== undefined &&
      (isNew || request.categories !== undefined || request.addCategories !== undefined)
    ) {
      const wanted = [...(request.categories ?? []), ...(request.addCategories ?? [])]
      const known = await existingTermIds(tx, categories.id, wanted)
      if (wanted.some((id) => !known.has(id))) {
        throw new AppError(400, 'invalid_term', 'A category does not exist')
      }
      const current = isNew ? [] : await itemTermIds(tx, item.id, categories.id)
      let next =
        request.categories !== undefined
          ? [...request.categories]
          : [...current, ...(request.addCategories ?? []).filter((id) => !current.includes(id))]
      if (next.length === 0) {
        const { default_category: fallback } = await settingsOf(tx)
        next = fallback === null ? [] : [fallback]
      }
      if (!sameList(next, current)) {
        await replaceItemTerms(tx, item.id, categories.id, next, now)
        changed = true
      }
    }
    const tags = await findTaxonomy(tx, 'post_tag')
    if (tags !== undefined && (request.tags !== undefined || request.addTags !== undefined)) {
      await lockTaxonomy(tx, tags.id)
      const ids = await ensureTags(
        tx,
        tags.id,
        [...(request.tags ?? []), ...(request.addTags ?? [])],
        (name) => sanitizeTitle(name, 'tag'),
        now,
      )
      const current = await itemTermIds(tx, item.id, tags.id)
      const next = request.tags !== undefined ? ids : [...current, ...ids.filter((id) => !current.includes(id))]
      if (!sameList(next, current)) {
        await replaceItemTerms(tx, item.id, tags.id, next, now)
        changed = true
      }
    }
    return changed
  }

  function requirePublish(actor: Actor, type: ContentTypeKey): void {
    if (!canPublishType(actor, type)) {
      throw new AppError(403, 'cannot_publish', 'You may not publish, schedule or make this private')
    }
  }

  async function create(auth: SessionAuth, request: CreateContentRequest, ctx: RequestContext): Promise<ContentItem> {
    const actor = actorOf(auth)
    const { type } = request
    if (!canEditType(actor, type)) {
      throw new ForbiddenError()
    }
    const requestedStatus = request.status ?? 'draft'
    if (PUBLISHING.has(requestedStatus) || (request.unpublishAt ?? null) !== null) {
      requirePublish(actor, type)
    }
    const authors = request.authors ?? [actor.id]
    if (!sameList(authors, [actor.id])) {
      if (!canEditOthersType(actor, type)) {
        throw new AppError(403, 'cannot_assign_authors', 'You may not choose the authors')
      }
      await checkAuthors(db, type, authors)
    }
    if (request.sticky === true) {
      checkSticky(actor, type)
    }
    if (requestedStatus === 'private' && (request.password ?? null) !== null) {
      throw new AppError(400, 'private_with_password', 'A private item cannot have a password')
    }
    const now = clock()
    const schedule = resolveSchedule(
      requestedStatus,
      toDate(request.publishedAt) ?? null,
      toDate(request.unpublishAt) ?? null,
      now,
    )
    const blocks =
      request.blocks === undefined
        ? { stored: [], text: '', refs: [], links: [] }
        : await checkSent(request.blocks, actor, type, [])
    const passwordHash =
      request.password === undefined || request.password === null ? null : await hashPassword(request.password)
    const settings = await settingsOf(db)
    const locale = settings.locale
    if (request.parentId !== undefined && request.parentId !== null) {
      await checkParent(db, { id: null, type, locale }, request.parentId)
    }
    const title = request.title ?? ''
    const excerpt = request.excerpt ?? ''
    const values: ContentValues = {
      slug: `new-${randomUUID()}`,
      title,
      excerpt,
      status: schedule.status,
      statusBeforeTrash: null,
      passwordHash,
      sticky: request.sticky ?? false,
      commentStatus: request.commentStatus ?? (type === 'post' ? settings.default_comment_status : 'closed'),
      menuOrder: request.menuOrder ?? 0,
      template: request.template ?? null,
      parentId: request.parentId ?? null,
      publishedAt: schedule.publishedAt,
      unpublishAt: toDate(request.unpublishAt) ?? null,
      blocks: blocks.stored,
      featuredMediaId: request.featuredMediaId ?? null,
      seo: request.seo === undefined ? {} : await seoOf(actor, request.seo),
    }
    await checkImage(actor, values.featuredMediaId)
    const search: SearchText = { config: textSearchConfig(locale), title, excerpt, blocks: blocks.text }

    const id = await inTransaction(db, async (tx) => {
      const scope = { type, locale, parentId: values.parentId }
      const wanted = sanitizeTitle(request.slug ?? '', '', locale) || sanitizeTitle(title, '', locale)
      const slug = wanted === '' ? values.slug : await uniqueContentSlug(tx, scope, wanted)
      const inserted = await insertContent(tx, { ...values, slug, type, locale, at: now }, search)
      if (wanted === '') {
        // No title yet: the slug is the short id, which exists only now (DATAMODEL «Decisions PLAN leaves open»).
        const fromId = await uniqueContentSlug(tx, scope, String(inserted.shortId), inserted.id)
        await updateContent(tx, inserted.id, { slug: fromId }, now)
      }
      await replaceAuthors(tx, inserted.id, authors, now)
      await replaceMediaRefs(tx, inserted.id, blocks.refs, now)
      await replaceLinkRefs(tx, inserted.id, blocks.links, now)
      await applyTerms(tx, { id: inserted.id, type }, request, true, now)
      await audit(tx, ctx, {
        actor: { id: actor.id, username: auth.account.username },
        action: 'content.created',
        objectType: type,
        objectId: inserted.id,
        newValue: { title, status: schedule.status },
      })
      return inserted.id
    })
    return loadItem(db, actor, id)
  }

  /**
   * The change of one item, inside the caller's transaction. Returns whether anything was written. Throws AppError for every
   * reason the change is refused, before anything is written.
   */
  async function updateIn(
    tx: Executor,
    auth: SessionAuth,
    id: string,
    request: UpdateContentRequest,
    passwordHash: string | null | undefined,
    ctx: RequestContext,
    additions: { readonly addCategories?: readonly string[]; readonly addTags?: readonly string[] } = {},
  ): Promise<Outcome> {
    const actor = actorOf(auth)
    const { row, authors, access } = await lockItem(tx, actor, id)
    if (!canEdit(actor, access)) {
      throw new ForbiddenError()
    }
    if (row.status === 'trash') {
      throw new AppError(409, 'content_trashed', 'Restore the item from the trash before changing it')
    }
    const type = row.type
    const now = clock()

    const requestedStatus: SettableContentStatus = request.status ?? row.status
    const publishedAt = request.publishedAt === undefined ? row.publishedAt : (toDate(request.publishedAt) ?? null)
    const unpublishAt = request.unpublishAt === undefined ? row.unpublishAt : (toDate(request.unpublishAt) ?? null)
    // The unpublish date is checked against the publish date (or now) only when it changes or the item is being published: a stored
    // one that has passed on a draft must not block every later save of it.
    const schedule = resolveSchedule(requestedStatus, publishedAt, null, now)
    const statusChanged = schedule.status !== row.status
    if (
      unpublishAt !== null &&
      (request.unpublishAt !== undefined ||
        (statusChanged && PUBLISHING.has(schedule.status)) ||
        !sameDate(schedule.publishedAt, row.publishedAt))
    ) {
      resolveSchedule(schedule.status, schedule.publishedAt, unpublishAt, now)
    }

    const wasPublished = row.status === 'publish' || row.status === 'future'
    if (
      (statusChanged && PUBLISHING.has(schedule.status)) ||
      !sameDate(unpublishAt, row.unpublishAt) ||
      (wasPublished && !sameDate(schedule.publishedAt, row.publishedAt))
    ) {
      requirePublish(actor, type)
    }

    const currentAuthors = authors.map((author) => author.id)
    const nextAuthors = request.authors ?? currentAuthors
    const authorsChanged = !sameList(nextAuthors, currentAuthors)
    if (authorsChanged) {
      if (!canEditOthersType(actor, type)) {
        throw new AppError(403, 'cannot_assign_authors', 'You may not choose the authors')
      }
      // Only the newly named authors are checked: an author who has since been disabled may stay where they were.
      await checkAuthors(
        tx,
        type,
        nextAuthors.filter((id) => !currentAuthors.includes(id)),
      )
    }

    const parentId = request.parentId === undefined ? row.parentId : request.parentId
    if (parentId !== row.parentId && parentId !== null) {
      await checkParent(tx, { id: row.id, type, locale: row.locale }, parentId)
    }
    const sticky = request.sticky ?? row.sticky
    if (sticky !== row.sticky) {
      checkSticky(actor, type)
    }

    const toPrivate = schedule.status === 'private'
    if (toPrivate && typeof request.password === 'string') {
      throw new AppError(400, 'private_with_password', 'A private item cannot have a password')
    }
    // WordPress' «Privat» clears the password; a password that was not sent stays.
    const nextPasswordHash = toPrivate ? null : passwordHash === undefined ? undefined : passwordHash

    const title = request.title ?? row.title
    const excerpt = request.excerpt ?? row.excerpt
    const blocks = request.blocks === undefined ? undefined : await checkSent(request.blocks, actor, type, row.blocks)

    // The slug: one that was sent; or, while the item is a draft or pending, a new one from a changed title when the old one was
    // made from the title; otherwise the old one. It is made unique again when it or the parent changes.
    let wanted = row.slug
    if (request.slug !== undefined) {
      wanted = sanitizeTitle(request.slug, '', row.locale) || sanitizeTitle(title, String(row.shortId), row.locale)
    } else if (
      title !== row.title &&
      (row.status === 'draft' || row.status === 'pending') &&
      isAutomaticSlug(row.slug, row.title, row.shortId, row.locale)
    ) {
      wanted = sanitizeTitle(title, String(row.shortId), row.locale)
    }
    const slug =
      wanted !== row.slug || parentId !== row.parentId
        ? await uniqueContentSlug(tx, { type, locale: row.locale, parentId }, wanted, row.id)
        : row.slug

    const changes: { -readonly [K in keyof ContentValues]?: ContentValues[K] } = {}
    const set = <K extends keyof ContentValues>(key: K, next: ContentValues[K], current: ContentValues[K]) => {
      if (!sameValue(next, current)) {
        changes[key] = next
      }
    }
    set('title', title, row.title)
    set('excerpt', excerpt, row.excerpt)
    set('slug', slug, row.slug)
    set('status', schedule.status, row.status)
    set('publishedAt', schedule.publishedAt, row.publishedAt)
    set('unpublishAt', unpublishAt, row.unpublishAt)
    set('sticky', sticky, row.sticky)
    set('commentStatus', request.commentStatus ?? row.commentStatus, row.commentStatus)
    set('menuOrder', request.menuOrder ?? row.menuOrder, row.menuOrder)
    set('template', request.template === undefined ? row.template : request.template, row.template)
    set('parentId', parentId, row.parentId)
    if (nextPasswordHash !== undefined && (nextPasswordHash !== null || row.hasPassword)) {
      changes.passwordHash = nextPasswordHash
    }
    if (blocks !== undefined && JSON.stringify(blocks.stored) !== JSON.stringify(row.blocks)) {
      changes.blocks = blocks.stored
    }
    if (request.featuredMediaId !== undefined && request.featuredMediaId !== row.featuredMediaId) {
      await checkImage(actor, request.featuredMediaId)
      changes.featuredMediaId = request.featuredMediaId
    }
    if (request.seo !== undefined) {
      const storedSeo = ContentSeo.catch({}).parse(row.seo)
      const seo = await seoOf(actor, request.seo, storedSeo.image)
      if (JSON.stringify(seo) !== JSON.stringify(storedSeo)) {
        changes.seo = seo
      }
    }

    const termsChanged = await applyTerms(
      tx,
      { id: row.id, type },
      { categories: request.categories, tags: request.tags, ...additions },
      false,
      now,
    )
    if (Object.keys(changes).length === 0 && !authorsChanged) {
      if (termsChanged) {
        // Only the terms changed: the item still counts as changed now.
        await updateContent(tx, row.id, {}, now)
        await audit(tx, ctx, {
          actor: { id: actor.id, username: auth.account.username },
          action: 'content.updated',
          objectType: type,
          objectId: row.id,
          oldValue: { status: row.status },
          newValue: { status: row.status, fields: ['terms'] },
        })
        return 'changed'
      }
      return 'unchanged'
    }
    const searchChanged = changes.title !== undefined || changes.excerpt !== undefined || changes.blocks !== undefined
    const search: SearchText | undefined = searchChanged
      ? {
          config: textSearchConfig(row.locale),
          title,
          excerpt,
          blocks: blocks?.text ?? storedBlocksText(row.blocks),
        }
      : undefined
    await updateContent(tx, row.id, changes, now, search)
    if (changes.blocks !== undefined && blocks !== undefined) {
      await replaceMediaRefs(tx, row.id, blocks.refs, now)
      await replaceLinkRefs(tx, row.id, blocks.links, now)
    }
    if (authorsChanged) {
      await replaceAuthors(tx, row.id, nextAuthors, now)
    }
    const fields = [
      ...Object.keys(changes),
      ...(authorsChanged ? ['authors'] : []),
      ...(termsChanged ? ['terms'] : []),
    ].sort()
    await audit(tx, ctx, {
      actor: { id: actor.id, username: auth.account.username },
      action: 'content.updated',
      objectType: type,
      objectId: row.id,
      oldValue: { status: row.status },
      newValue: { status: schedule.status, fields },
    })
    return 'changed'
  }

  async function trashIn(tx: Executor, auth: SessionAuth, id: string, ctx: RequestContext): Promise<Outcome> {
    const actor = actorOf(auth)
    const { row, access } = await lockItem(tx, actor, id)
    if (!canDelete(actor, access)) {
      throw new ForbiddenError()
    }
    if (row.status === 'trash') {
      throw new AppError(409, 'content_trashed', 'The item is in the trash already')
    }
    const scope = { type: row.type, locale: row.locale, parentId: row.parentId }
    const slug = await uniqueContentSlug(tx, scope, trashedSlug(row.slug), row.id)
    await updateContent(tx, row.id, { status: 'trash', statusBeforeTrash: row.status, slug }, clock())
    await audit(tx, ctx, {
      actor: { id: actor.id, username: auth.account.username },
      action: 'content.trashed',
      objectType: row.type,
      objectId: row.id,
      oldValue: { status: row.status },
    })
    return 'changed'
  }

  async function restoreIn(tx: Executor, auth: SessionAuth, id: string, ctx: RequestContext): Promise<Outcome> {
    const actor = actorOf(auth)
    const { row, access } = await lockItem(tx, actor, id)
    if (!canDelete(actor, access)) {
      throw new ForbiddenError()
    }
    if (row.status !== 'trash') {
      throw new AppError(409, 'not_trashed', 'The item is not in the trash')
    }
    const status = row.statusBeforeTrash ?? 'draft'
    // Back to a publishing status is a publish like any other: it needs the publish capability.
    if (PUBLISHING.has(status)) {
      requirePublish(actor, row.type)
    }
    const scope = { type: row.type, locale: row.locale, parentId: row.parentId }
    const slug = await uniqueContentSlug(tx, scope, untrashedSlug(row.slug) || String(row.shortId), row.id)
    await updateContent(tx, row.id, { status, statusBeforeTrash: null, slug }, clock())
    await audit(tx, ctx, {
      actor: { id: actor.id, username: auth.account.username },
      action: 'content.restored',
      objectType: row.type,
      objectId: row.id,
      newValue: { status },
    })
    return 'changed'
  }

  async function removeIn(tx: Executor, auth: SessionAuth, id: string, ctx: RequestContext): Promise<Outcome> {
    const actor = actorOf(auth)
    const { row, access } = await lockItem(tx, actor, id)
    if (!canDelete(actor, access)) {
      throw new ForbiddenError()
    }
    if (row.status !== 'trash') {
      throw new AppError(409, 'not_trashed', 'Only an item in the trash can be deleted for good')
    }
    await deleteContentPermanently(tx, row.id)
    await audit(tx, ctx, {
      actor: { id: actor.id, username: auth.account.username },
      action: 'content.deleted',
      objectType: row.type,
      objectId: row.id,
      oldValue: { title: row.title, slug: untrashedSlug(row.slug) },
    })
    return 'changed'
  }

  /** Hashes a password that was sent (outside the transaction: Argon2 takes a moment). `null` stays a removal. */
  async function passwordHashOf(password: string | null | undefined): Promise<string | null | undefined> {
    return typeof password === 'string' ? hashPassword(password) : password
  }

  return {
    async list(auth, query) {
      const actor = actorOf(auth)
      if (!canEditType(actor, query.type)) {
        throw new ForbiddenError()
      }
      const settings = await settingsOf(db)
      const visibility = {
        type: query.type,
        accountId: actor.id,
        readPrivate: actor.capabilities.has(typeCapabilities(query.type).readPrivate),
      }
      const context: ListContext = {
        visibility,
        filter: {
          status: query.status,
          author: query.author,
          search: query.search,
          month: query.month,
          termIds:
            query.category !== undefined
              ? await termWithDescendants(db, query.category)
              : query.tag !== undefined
                ? [query.tag]
                : undefined,
        },
        zone: timeZoneOf(settings),
        searchConfig: textSearchConfig(settings.locale),
      }
      const orderby = query.orderby ?? (query.type === 'page' ? 'menu_order' : 'date')
      const order = query.order ?? (orderby === 'date' || orderby === 'modified' ? 'desc' : 'asc')
      const perPage = query.per_page
      const offset = (query.page - 1) * perPage
      const searching = query.search !== undefined && query.search !== ''
      const hierarchical = query.type === 'page' && orderby === 'menu_order' && !searching

      let rows: ContentRow[]
      let depths = new Map<string, number>()
      let total: number
      if (hierarchical) {
        const flat = flattenTree(await listContentTree(db, context, order))
        total = flat.length
        const slice = flat.slice(offset, offset + perPage)
        depths = new Map(slice.map((entry) => [entry.id, entry.depth]))
        const byId = new Map((await findContentRows(db, [...depths.keys()])).map((row) => [row.id, row]))
        rows = slice.flatMap((entry) => {
          const row = byId.get(entry.id)
          return row === undefined ? [] : [row]
        })
      } else {
        ;[rows, total] = await Promise.all([
          listContentPage(db, context, orderby, order, perPage, offset),
          countContent(db, context),
        ])
      }
      const [counts, months, authors, terms] = await Promise.all([
        countByStatus(db, visibility),
        listMonths(db, visibility, context.zone, query.status === 'trash'),
        authorsOf(
          db,
          rows.map((row) => row.id),
        ),
        termsOfContent(
          db,
          rows.map((row) => row.id),
        ),
      ])
      const items: ContentListItem[] = rows.map((row) => ({
        ...baseFields(row, authors.get(row.id) ?? [], actor, terms.get(row.id)),
        depth: depths.get(row.id) ?? 0,
      }))
      return {
        items,
        total,
        totalPages: Math.ceil(total / perPage),
        page: query.page,
        perPage,
        counts,
        months,
        timeZone: intlTimeZone(context.zone),
      }
    },

    async counts(auth, type) {
      const actor = actorOf(auth)
      if (!canEditType(actor, type)) {
        return undefined
      }
      return countByStatus(db, {
        type,
        accountId: actor.id,
        readPrivate: actor.capabilities.has(typeCapabilities(type).readPrivate),
      })
    },

    get: (auth, id) => loadItem(db, actorOf(auth), id),

    async authors(auth, type) {
      const actor = actorOf(auth)
      if (!canEditType(actor, type) || !canEditOthersType(actor, type)) {
        throw new ForbiddenError()
      }
      const rows = await accountsWithCapability(db, typeCapabilities(type).edit)
      return { authors: rows.map((row) => ({ id: row.id, username: row.username, displayName: row.displayName })) }
    },

    create,

    async update(auth, id, request, ctx) {
      const passwordHash = await passwordHashOf(request.password)
      await inTransaction(db, (tx) => updateIn(tx, auth, id, request, passwordHash, ctx))
      return loadItem(db, actorOf(auth), id)
    },

    async publish(auth, id, ctx) {
      await inTransaction(db, (tx) => updateIn(tx, auth, id, { status: 'publish' }, undefined, ctx))
      return loadItem(db, actorOf(auth), id)
    },

    async trash(auth, id, ctx) {
      await inTransaction(db, (tx) => trashIn(tx, auth, id, ctx))
      return loadItem(db, actorOf(auth), id)
    },

    async restore(auth, id, ctx) {
      await inTransaction(db, (tx) => restoreIn(tx, auth, id, ctx))
      return loadItem(db, actorOf(auth), id)
    },

    async remove(auth, id, ctx) {
      await inTransaction(db, (tx) => removeIn(tx, auth, id, ctx))
    },

    async bulk(auth, request, ctx) {
      const actor = actorOf(auth)
      let ids: readonly string[]
      let act: (tx: Executor, id: string) => Promise<Outcome>
      switch (request.action) {
        case 'trash':
          ids = request.ids
          act = (tx, id) => trashIn(tx, auth, id, ctx)
          break
        case 'restore':
          ids = request.ids
          act = (tx, id) => restoreIn(tx, auth, id, ctx)
          break
        case 'delete':
          ids = request.ids
          act = (tx, id) => removeIn(tx, auth, id, ctx)
          break
        case 'edit': {
          ids = request.ids
          const { changes } = request
          const update: UpdateContentRequest = {
            ...(changes.status === undefined ? {} : { status: changes.status }),
            ...(changes.authorId === undefined ? {} : { authors: [changes.authorId] }),
            ...(changes.commentStatus === undefined ? {} : { commentStatus: changes.commentStatus }),
            ...(changes.sticky === undefined ? {} : { sticky: changes.sticky }),
            ...(changes.parentId === undefined ? {} : { parentId: changes.parentId }),
            ...(changes.template === undefined ? {} : { template: changes.template }),
          }
          const additions = {
            ...(changes.addCategories === undefined ? {} : { addCategories: changes.addCategories }),
            ...(changes.addTags === undefined ? {} : { addTags: changes.addTags }),
          }
          act = async (tx, id) => {
            // An addition of terms is skipped quietly for a page, which has none (WordPress' bulk edit leaves pages' terms alone).
            const target = await findContent(tx, id)
            return updateIn(tx, auth, id, update, undefined, ctx, target?.type === 'post' ? additions : {})
          }
          break
        }
        case 'empty_trash': {
          if (!canEditType(actor, request.type)) {
            throw new ForbiddenError()
          }
          ids = await trashedIds(db, request.type)
          act = (tx, id) => removeIn(tx, auth, id, ctx)
          break
        }
        default:
          return request satisfies never
      }

      const emptying = request.action === 'empty_trash'
      const movesPages = request.action === 'edit' && request.changes.parentId !== undefined
      return inTransaction(db, async (tx) => {
        if (movesPages) {
          // Before any row is locked: the single PATCH takes the row first and then this lock, so taking it later here could deadlock.
          await lockPageTree(tx, 'page')
        }
        const result: ContentBulkResponse = { changed: [], unchanged: [], skipped: [] }
        // In a fixed order, so two bulk requests over the same items lock them in the same order and cannot deadlock. The answer is
        // put back in the request's order below.
        for (const id of [...ids].sort()) {
          try {
            // A savepoint per item: one that is refused leaves the others' changes standing.
            const outcome = await tx.transaction((savepoint) => act(savepoint, id))
            result[outcome].push(id)
          } catch (caught) {
            const reason = caught instanceof AppError ? skipReasonOf(caught) : undefined
            if (reason === undefined) {
              throw caught
            }
            // «Tøm papirkurven» names nothing: what the account may not delete is simply not part of it.
            if (!emptying) {
              result.skipped.push({ id, reason })
            }
          }
        }
        const position = new Map(ids.map((id, index) => [id, index]))
        const byRequest = (a: string, b: string) => (position.get(a) ?? 0) - (position.get(b) ?? 0)
        return {
          changed: result.changed.sort(byRequest),
          unchanged: result.unchanged.sort(byRequest),
          skipped: result.skipped.sort((a, b) => byRequest(a.id, b.id)),
        }
      })
    },
  }
}
