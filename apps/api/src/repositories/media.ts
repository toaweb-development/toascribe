// The media library's queries (M1.2, typescript §8): `media`, `media_folder`, and the media references in `content_ref`.
import { schema } from '@toascribe/db'
import { GENERATED_SUFFIX } from '@toascribe/media'
import { MediaVariantsData } from '@toascribe/shared'
import type { MediaProcessing, MediaVariants, MediaVisibility } from '@toascribe/shared'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Executor } from './executor.ts'
import { escapeLike } from './users.ts'

const { account, content, contentRef, media, mediaFolder } = schema

export interface MediaRow {
  readonly id: string
  readonly title: string
  readonly alt: string
  readonly caption: string
  readonly description: string
  readonly mime: string
  readonly size: number
  readonly width: number | null
  readonly height: number | null
  readonly sha256: string
  readonly folderId: string | null
  readonly uploadedBy: string | null
  readonly attachedTo: string | null
  readonly visibility: MediaVisibility
  readonly variants: MediaVariantsData
  readonly storageKey: string
  readonly fileName: string
  readonly processing: MediaProcessing
  readonly processingError: string | null
  readonly createdAt: Date
  readonly modifiedAt: Date
}

const columns = {
  id: media.id,
  title: media.title,
  alt: media.alt,
  caption: media.caption,
  description: media.description,
  mime: media.mime,
  size: media.size,
  width: media.width,
  height: media.height,
  sha256: media.sha256,
  folderId: media.folderId,
  uploadedBy: media.uploadedBy,
  attachedTo: media.attachedTo,
  // Checked in the database (ck_media_visibility, ck_media_processing); variants are written by the worker in this shape.
  visibility: sql<MediaVisibility>`${media.visibility}`,
  variants: media.variants,
  storageKey: media.storageKey,
  fileName: media.fileName,
  processing: sql<MediaProcessing>`${media.processing}`,
  processingError: media.processingError,
  createdAt: media.createdAt,
  modifiedAt: media.modifiedAt,
}

type RawRow = Omit<MediaRow, 'variants'> & { readonly variants: unknown }

/** The row with its variants in the shape the worker writes (a row without any yet has `{}`; an odd value counts as none). */
function normalize(row: RawRow): MediaRow {
  const parsed = MediaVariantsData.safeParse(row.variants)
  return { ...row, variants: parsed.success ? parsed.data : { sizes: {} } }
}

export interface MediaFilter {
  readonly search: string | undefined
  /** Only these MIME types (a group of the type filter). */
  readonly mimes: readonly string[] | undefined
  readonly month: string | undefined
  /** A folder id, `none` for the top, or undefined for every folder. */
  readonly folder: string | undefined
  readonly uploadedBy: string | undefined
  readonly ids: readonly string[] | undefined
  /** Who is asking: private files are listed only to their uploader and to `read_private_posts`. */
  readonly accountId: string
  readonly readPrivate: boolean
  /** The site's time zone for the month filter (an IANA name or an offset `+01:00`). */
  readonly timeZone: string
}

function filterCondition(filter: MediaFilter): SQL {
  const conditions: (SQL | undefined)[] = []
  if (!filter.readPrivate) {
    conditions.push(or(eq(media.visibility, 'public'), eq(media.uploadedBy, filter.accountId)))
  }
  if (filter.search !== undefined && filter.search !== '') {
    const pattern = `%${escapeLike(filter.search)}%`
    conditions.push(
      sql`(${media.title} ilike ${pattern} or ${media.fileName} ilike ${pattern} or ${media.alt} ilike ${pattern}
        or ${media.caption} ilike ${pattern} or ${media.description} ilike ${pattern})`,
    )
  }
  if (filter.mimes !== undefined) {
    conditions.push(filter.mimes.length === 0 ? sql`false` : inArray(media.mime, [...filter.mimes]))
  }
  if (filter.month !== undefined) {
    conditions.push(sql`to_char(${media.createdAt} at time zone ${filter.timeZone}, 'YYYY-MM') = ${filter.month}`)
  }
  if (filter.folder === 'none') {
    conditions.push(isNull(media.folderId))
  } else if (filter.folder !== undefined) {
    conditions.push(eq(media.folderId, filter.folder))
  }
  if (filter.uploadedBy !== undefined) {
    conditions.push(eq(media.uploadedBy, filter.uploadedBy))
  }
  if (filter.ids !== undefined) {
    conditions.push(filter.ids.length === 0 ? sql`false` : inArray(media.id, [...filter.ids]))
  }
  return and(...conditions) ?? sql`true`
}

export async function listMediaPage(
  db: Executor,
  filter: MediaFilter,
  orderby: 'date' | 'title',
  order: 'asc' | 'desc',
  limit: number,
  offset: number,
): Promise<MediaRow[]> {
  const direction = order === 'asc' ? asc : desc
  const rows = await db
    .select(columns)
    .from(media)
    .where(filterCondition(filter))
    .orderBy(
      ...(orderby === 'title'
        ? [direction(sql`lower(coalesce(nullif(${media.title}, ''), ${media.fileName}))`), direction(media.id)]
        : [direction(media.createdAt), direction(media.id)]),
    )
    .limit(limit)
    .offset(offset)
  return rows.map(normalize)
}

export async function countMedia(db: Executor, filter: MediaFilter): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(media)
    .where(filterCondition(filter))
  return rows[0]?.n ?? 0
}

/** The months with files the account may see, newest first. */
export async function listMediaMonths(
  db: Executor,
  filter: Pick<MediaFilter, 'accountId' | 'readPrivate' | 'timeZone'>,
): Promise<string[]> {
  const month = sql<string>`to_char(${media.createdAt} at time zone ${filter.timeZone}, 'YYYY-MM')`
  const rows = await db
    .selectDistinct({ month })
    .from(media)
    .where(filter.readPrivate ? undefined : or(eq(media.visibility, 'public'), eq(media.uploadedBy, filter.accountId)))
  return rows.map((row) => row.month).sort((a, b) => b.localeCompare(a))
}

export async function findMedia(
  db: Executor,
  id: string,
  options: { readonly forUpdate?: boolean } = {},
): Promise<MediaRow | undefined> {
  const query = db.select(columns).from(media).where(eq(media.id, id))
  const rows = await (options.forUpdate === true ? query.for('update', { of: media }) : query)
  return rows[0] === undefined ? undefined : normalize(rows[0])
}

/**
 * The file a key under /uploads/ belongs to: the original with that key, or the original whose generated file it is
 * (`<original without ext>-<version>-<size>.webp` or `-e<ms>.webp`, found by the original key's prefix and then checked against its
 * current variants, so the address of a file that an edit or new sizes replaced answers 404).
 */
export async function findMediaByKey(db: Executor, key: string): Promise<MediaRow | undefined> {
  const exact = await db.select(columns).from(media).where(eq(media.storageKey, key)).limit(1)
  if (exact[0] !== undefined) {
    return normalize(exact[0])
  }
  const base = key.replace(GENERATED_SUFFIX, '')
  if (base === key) {
    return undefined
  }
  const prefix = `${escapeLike(base)}.%`
  const rows = await db
    .select(columns)
    .from(media)
    .where(sql`${media.storageKey} like ${prefix}`)
    .limit(5)
  return rows.map(normalize).find((row) => variantKeys(row.variants).includes(key))
}

/** Every key of the generated files of a media row. */
export function variantKeys(variants: MediaVariantsData): string[] {
  return [
    ...Object.values(variants.sizes).map((size) => size.key),
    ...(variants.scaled === undefined ? [] : [variants.scaled.key]),
    ...(variants.edited === undefined ? [] : [variants.edited.key]),
  ]
}

export interface MediaValues {
  readonly title: string
  readonly alt: string
  readonly caption: string
  readonly description: string
  readonly mime: string
  readonly size: number
  readonly width: number | null
  readonly height: number | null
  readonly sha256: string
  readonly folderId: string | null
  readonly uploadedBy: string | null
  readonly attachedTo: string | null
  readonly visibility: MediaVisibility
  readonly storageKey: string
  readonly fileName: string
  readonly processing: MediaProcessing
}

export async function insertMedia(db: Executor, values: MediaValues, at: Date): Promise<string> {
  const [row] = await db
    .insert(media)
    .values({ ...values, variants: { sizes: {} }, createdAt: at, modifiedAt: at })
    .returning({ id: media.id })
  if (row === undefined) {
    throw new Error('insert into media returned no row')
  }
  return row.id
}

export type MediaChanges = Partial<
  MediaValues & {
    readonly variants: MediaVariantsData
    readonly processingError: string | null
    /** Back to 0 whenever the file is handed to the worker anew (MEDIA_MAX_ATTEMPTS). */
    readonly processingAttempts: number
  }
>

export async function updateMedia(db: Executor, id: string, changes: MediaChanges, at: Date): Promise<void> {
  const { variants, ...rest } = changes
  await db
    .update(media)
    .set({
      ...rest,
      // The typed shape as the plain JSON the column holds (an optional key that is missing is left out).
      ...(variants === undefined ? {} : { variants: JSON.parse(JSON.stringify(variants)) as MediaVariants }),
      modifiedAt: at,
    })
    .where(eq(media.id, id))
}

export async function deleteMedia(db: Executor, id: string): Promise<void> {
  await db.delete(media).where(eq(media.id, id))
}

/** The display names of the uploaders. */
export async function accountNames(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map()
  }
  const rows = await db
    .select({ id: account.id, displayName: account.displayName })
    .from(account)
    .where(inArray(account.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row.displayName]))
}

export interface MediaUsageRow {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly status: string
  readonly statusBeforeTrash: string | null
}

/** «Brukes på» (K-122): the content whose blocks use the file, by title. The service shows only what the asker may read. */
export function mediaUsage(db: Executor, mediaId: string): Promise<MediaUsageRow[]> {
  return db
    .selectDistinct({
      id: content.id,
      type: content.type,
      title: content.title,
      status: content.status,
      statusBeforeTrash: content.statusBeforeTrash,
    })
    .from(contentRef)
    .innerJoin(content, eq(content.id, contentRef.contentId))
    .where(and(eq(contentRef.kind, 'media'), eq(contentRef.targetMediaId, mediaId)))
    .orderBy(content.title)
}

/** Replaces the media references of a content item (derived from its blocks on every save). */
export async function replaceMediaRefs(
  db: Executor,
  contentId: string,
  refs: readonly { readonly mediaId: string; readonly blockId: string }[],
  at: Date,
): Promise<void> {
  await db.delete(contentRef).where(and(eq(contentRef.contentId, contentId), eq(contentRef.kind, 'media')))
  if (refs.length === 0) {
    return
  }
  // Only files that exist: a block may name one that was deleted meanwhile.
  const existing = await db
    .select({ id: media.id })
    .from(media)
    .where(inArray(media.id, [...new Set(refs.map((ref) => ref.mediaId))]))
  const known = new Set(existing.map((row) => row.id))
  const rows = refs.filter((ref) => known.has(ref.mediaId))
  if (rows.length > 0) {
    await db.insert(contentRef).values(
      rows.map((ref) => ({
        contentId,
        kind: 'media',
        targetMediaId: ref.mediaId,
        blockId: ref.blockId,
        createdAt: at,
      })),
    )
  }
}

// --- Folders ---------------------------------------------------------------------------------------------------------------------

export interface FolderRow {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly count: number
}

export function listFolders(db: Executor): Promise<FolderRow[]> {
  return db
    .select({
      id: mediaFolder.id,
      name: mediaFolder.name,
      parentId: mediaFolder.parentId,
      count: sql<number>`(select count(*)::int from media where media.folder_id = "media_folder"."id")`,
    })
    .from(mediaFolder)
    .orderBy(sql`lower(${mediaFolder.name})`, mediaFolder.id)
}

export async function findFolder(db: Executor, id: string): Promise<FolderRow | undefined> {
  const rows = await db
    .select({ id: mediaFolder.id, name: mediaFolder.name, parentId: mediaFolder.parentId, count: sql<number>`0` })
    .from(mediaFolder)
    .where(eq(mediaFolder.id, id))
  return rows[0]
}

/** Whether a folder beside it (same parent) already has the name, without regard to case. */
export async function folderNameTaken(
  db: Executor,
  parentId: string | null,
  name: string,
  excludeId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: mediaFolder.id })
    .from(mediaFolder)
    .where(
      and(
        parentId === null ? isNull(mediaFolder.parentId) : eq(mediaFolder.parentId, parentId),
        sql`lower(${mediaFolder.name}) = lower(${name})`,
        excludeId === null ? undefined : ne(mediaFolder.id, excludeId),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function folderAncestorIds(db: Executor, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive chain(id, parent_id, depth) as (
      select id, parent_id, 0 from media_folder where id = ${id}
      union all
      select f.id, f.parent_id, chain.depth + 1 from media_folder f join chain on f.id = chain.parent_id where chain.depth < 10000
    )
    select id from chain where depth > 0`)
  return result.rows.map((row) => row.id)
}

/** Serialises changes of the folder tree until the end of the transaction (names beside each other, cycles). */
export async function lockFolders(db: Executor): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended('toascribe:media-folders', 0))`)
}

export async function insertFolder(db: Executor, name: string, parentId: string | null, at: Date): Promise<string> {
  const [row] = await db
    .insert(mediaFolder)
    .values({ name, parentId, createdAt: at, modifiedAt: at })
    .returning({ id: mediaFolder.id })
  if (row === undefined) {
    throw new Error('insert into media_folder returned no row')
  }
  return row.id
}

export async function updateFolder(
  db: Executor,
  id: string,
  changes: { name?: string; parentId?: string | null },
  at: Date,
): Promise<void> {
  await db
    .update(mediaFolder)
    .set({ ...changes, modifiedAt: at })
    .where(eq(mediaFolder.id, id))
}

/** Deletes a folder and the folders below it; their files move to the top of the library (the foreign keys). */
export async function deleteFolder(db: Executor, id: string): Promise<void> {
  await db.delete(mediaFolder).where(eq(mediaFolder.id, id))
}
