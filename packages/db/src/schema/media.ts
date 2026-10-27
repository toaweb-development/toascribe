// The media library (K-110 to K-126). Media is its own table, not a content type as in WordPress.
import { sql } from 'drizzle-orm'
import { MEDIA_PROCESSING, MEDIA_VISIBILITY } from '@toascribe/shared'
import type { FocalPoint, MediaVariants } from '@toascribe/shared'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { account } from './accounts.ts'
import { createdAt, id, oneOf, timestamps } from './columns.ts'
import { content } from './content.ts'
import { term } from './taxonomy.ts'

/** A folder in the media library (K-119). Folders nest. */
export const mediaFolder = pgTable(
  'media_folder',
  {
    id: id(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // No two folders with the same name side by side; two top-level folders (parent null) count as side by side.
    unique('uq_media_folder_parent_id_name').on(t.parentId, t.name).nullsNotDistinct(),
    // Deleting a folder deletes its subfolders; the files in all of them move to the top (fk_media_folder_id).
    foreignKey({ name: 'fk_media_folder_parent_id', columns: [t.parentId], foreignColumns: [t.id] }).onDelete(
      'cascade',
    ),
  ],
)

/** An uploaded file. The file itself is in storage under storage_key; generated sizes are in variants. */
export const media = pgTable(
  'media',
  {
    id: id(),
    title: text('title').notNull().default(''),
    alt: text('alt').notNull().default(''),
    caption: text('caption').notNull().default(''),
    description: text('description').notNull().default(''),
    mime: text('mime').notNull(),
    /** Bytes. */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Pixels; null for files without dimensions. */
    width: integer('width'),
    height: integer('height'),
    /** Hex SHA-256 of the original file, for duplicate detection (K-121). */
    sha256: text('sha256').notNull(),
    focalPoint: jsonb('focal_point').$type<FocalPoint>(),
    folderId: uuid('folder_id'),
    uploadedBy: uuid('uploaded_by'),
    /** The content it was uploaded to (WordPress post_parent of an attachment). */
    attachedTo: uuid('attached_to'),
    visibility: text('visibility').notNull().default('public'),
    variants: jsonb('variants').$type<MediaVariants>().notNull().default({}),
    /** Key of the original in the storage driver (local disk or S3), e.g. 2026/10/photo.jpg. */
    storageKey: text('storage_key').notNull(),
    /** The name the file had when it was uploaded (shown in the details; the stored key is made from it). */
    fileName: text('file_name').notNull().default(''),
    /** The worker's work on the file (M1.2): `pending` until the sizes are made, `failed` with the reason in processing_error. */
    processing: text('processing').notNull().default('ready'),
    processingError: text('processing_error'),
    /**
     * Runs of the worker since the last upload, replacement, edit or «Lag bildestørrelser på nytt» (review M6). Counted when a run
     * starts, so a run that kills the worker counts too; after MEDIA_MAX_ATTEMPTS the file is `failed` and not tried again.
     */
    processingAttempts: integer('processing_attempts').notNull().default(0),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_media_storage_key').on(t.storageKey),
    check('ck_media_visibility', oneOf(t.visibility, MEDIA_VISIBILITY)),
    check('ck_media_processing', oneOf(t.processing, MEDIA_PROCESSING)),
    check('ck_media_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('ck_media_size', sql`${t.size} >= 0`),
    check('ck_media_processing_attempts', sql`${t.processingAttempts} >= 0`),
    check(
      'ck_media_dimensions',
      sql`(${t.width} is null) = (${t.height} is null) and ${t.width} > 0 and ${t.height} > 0`,
    ),
    // Files in a deleted folder move to the top of the library.
    foreignKey({ name: 'fk_media_folder_id', columns: [t.folderId], foreignColumns: [mediaFolder.id] }).onDelete(
      'set null',
    ),
    // Files stay when the uploader is deleted (WordPress reassigns them; K-021 decides about content, not media).
    foreignKey({ name: 'fk_media_uploaded_by', columns: [t.uploadedBy], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    // Files stay, unattached, when the content they were uploaded to is deleted (as in WordPress).
    foreignKey({ name: 'fk_media_attached_to', columns: [t.attachedTo], foreignColumns: [content.id] }).onDelete(
      'set null',
    ),
    // Folder view, «uploaded by me», «uploaded to this item», and the three SET NULL actions.
    // /uploads/<key> of a size (`<original without ext>-300x200.webp`) finds its file by the original key's prefix.
    index('idx_media_storage_key_prefix').on(t.storageKey.op('text_pattern_ops')),
    index('idx_media_folder_id')
      .on(t.folderId)
      .where(sql`${t.folderId} is not null`),
    index('idx_media_uploaded_by')
      .on(t.uploadedBy)
      .where(sql`${t.uploadedBy} is not null`),
    index('idx_media_attached_to')
      .on(t.attachedTo)
      .where(sql`${t.attachedTo} is not null`),
  ],
)

/** Tags on media (K-120): terms of a media taxonomy. */
export const mediaTerm = pgTable(
  'media_term',
  {
    mediaId: uuid('media_id').notNull(),
    termId: uuid('term_id').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'pk_media_term', columns: [t.mediaId, t.termId] }),
    // Links go with the file ...
    foreignKey({ name: 'fk_media_term_media_id', columns: [t.mediaId], foreignColumns: [media.id] }).onDelete(
      'cascade',
    ),
    // ... and with the term.
    foreignKey({ name: 'fk_media_term_term_id', columns: [t.termId], foreignColumns: [term.id] }).onDelete('cascade'),
    index('idx_media_term_term_id').on(t.termId),
  ],
)
