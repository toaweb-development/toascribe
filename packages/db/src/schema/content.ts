// Content and everything that hangs off one content item (PLAN «Datamodell i PostgreSQL»; K-060 to K-107).
// `content` always holds the published version. A pending change to published content lives in content_draft (at most
// one per item), each user's autosave in content_autosave, and snapshots in content_revision. See docs/DATAMODEL.md.
import { sql } from 'drizzle-orm'
import {
  COMMENT_STATUS,
  CONTENT_REF_KIND,
  CONTENT_STATUS,
  CONTENT_STATUS_BEFORE_TRASH,
  TEMPLATE_TYPE,
} from '@toascribe/shared'
import type {
  Blocks,
  ContentFields,
  ContentSeo,
  ContentSnapshot,
  ContentTypeSchema,
  FieldGroupSchema,
} from '@toascribe/shared'
import {
  bigint,
  boolean,
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
import { createdAt, id, oneOf, timestamps, timestamptz, tsvector } from './columns.ts'
import { release } from './editorial.ts'
import { media } from './media.ts'

/** Posts, pages and every other content type (WordPress wp_posts + wp_postmeta). */
export const content = pgTable(
  'content',
  {
    id: id(),
    /** The number in `/?p=` short links (K-065). Assigned by PostgreSQL; never written by the app. */
    shortId: bigint('short_id', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    /** Content type key: post, page, or a type from code or content_type. Not a foreign key: code types have no row. */
    type: text('type').notNull(),
    locale: text('locale').notNull(),
    /** Shared by the language versions of one item (K-332, phase 4). */
    translationGroup: uuid('translation_group'),
    /** Always set: the service makes one from the title, or from short_id while there is no title. */
    slug: text('slug').notNull(),
    title: text('title').notNull().default(''),
    excerpt: text('excerpt').notNull().default(''),
    status: text('status').notNull(),
    statusBeforeTrash: text('status_before_trash'),
    /** Argon2id hash of the post password (K-067). WordPress keeps it in plain text; here it can be replaced, not read. */
    passwordHash: text('password_hash'),
    sticky: boolean('sticky').notNull().default(false),
    commentStatus: text('comment_status').notNull(),
    menuOrder: integer('menu_order').notNull().default(0),
    /** Template slug chosen for this item (K-155); null uses the template hierarchy. */
    template: text('template'),
    parentId: uuid('parent_id'),
    featuredMediaId: uuid('featured_media_id'),
    publishedAt: timestamptz('published_at'),
    unpublishAt: timestamptz('unpublish_at'),
    /** Step key of the item's workflow (K-097). Editorial only: it never changes status by itself. */
    workflowState: text('workflow_state'),
    blocks: jsonb('blocks').$type<Blocks>().notNull().default([]),
    fields: jsonb('fields').$type<ContentFields>().notNull().default({}),
    seo: jsonb('seo').$type<ContentSeo>().notNull().default({}),
    /**
     * Full-text vector, written by the content service on every save: title (weight A), excerpt (B) and the text of
     * the blocks (C), with the text search configuration of the item's locale (K-240). See docs/DATAMODEL.md.
     */
    search: tsvector('search')
      .notNull()
      .default(sql`''::tsvector`),
    /** The post ID in the WordPress export it was imported from (K-200). */
    legacyWpId: bigint('legacy_wp_id', { mode: 'number' }),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_content_short_id').on(t.shortId),
    // One slug per type, language and parent; a top-level item (parent null) collides with another top-level item.
    // Trashed items take part: like WordPress, the service renames a trashed slug to <slug>__trashed and restores it.
    unique('uq_content_type_locale_parent_id_slug').on(t.type, t.locale, t.parentId, t.slug).nullsNotDistinct(),
    check('ck_content_slug', sql`${t.slug} <> ''`),
    check('ck_content_status', oneOf(t.status, CONTENT_STATUS)),
    check('ck_content_status_before_trash', oneOf(t.statusBeforeTrash, CONTENT_STATUS_BEFORE_TRASH)),
    check('ck_content_trash', sql`(${t.status} = 'trash') = (${t.statusBeforeTrash} is not null)`),
    check('ck_content_comment_status', oneOf(t.commentStatus, COMMENT_STATUS)),
    // A deleted parent leaves its children at the top level (the service moves them to the grandparent first, as
    // WordPress does; this is the fallback).
    foreignKey({ name: 'fk_content_parent_id', columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
    // Deleting the image leaves the content without a featured image.
    foreignKey({
      name: 'fk_content_featured_media_id',
      columns: [t.featuredMediaId],
      foreignColumns: [media.id],
    }).onDelete('set null'),
    // Lists and archives: one type, one status, newest first.
    index('idx_content_type_status_published_at').on(t.type, t.status, t.publishedAt),
    index('idx_content_parent_id')
      .on(t.parentId)
      .where(sql`${t.parentId} is not null`),
    index('idx_content_featured_media_id')
      .on(t.featuredMediaId)
      .where(sql`${t.featuredMediaId} is not null`),
    // Containment (@>) and jsonpath (@?, @@) queries on custom fields and blocks (K-324). jsonb_path_ops is smaller and
    // faster than the default opclass and supports both; it cannot answer the key-exists operator ?, which we avoid.
    index('idx_content_fields').using('gin', t.fields.op('jsonb_path_ops')),
    index('idx_content_blocks').using('gin', t.blocks.op('jsonb_path_ops')),
    index('idx_content_search').using('gin', t.search),
  ],
)

/** A content type made in admin (K-094). Types defined in code have no row unless admin changed them. */
export const contentType = pgTable(
  'content_type',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    schema: jsonb('schema').$type<ContentTypeSchema>().notNull().default({}),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_content_type_key').on(t.key)],
)

/** A group of custom fields made in admin (K-093, the ACF equivalent). */
export const fieldGroup = pgTable(
  'field_group',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    schema: jsonb('schema').$type<FieldGroupSchema>().notNull().default({}),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_field_group_key').on(t.key)],
)

/** The authors of a content item, in order (K-066). */
export const contentAuthor = pgTable(
  'content_author',
  {
    contentId: uuid('content_id').notNull(),
    accountId: uuid('account_id').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'pk_content_author', columns: [t.contentId, t.accountId] }),
    // Author links go with the content.
    foreignKey({ name: 'fk_content_author_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // Deleting an account never deletes content: the service reassigns or deletes the content first (K-021).
    foreignKey({ name: 'fk_content_author_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'restrict',
    ),
    // Author archives, and the RESTRICT check when an account is deleted.
    index('idx_content_author_account_id').on(t.accountId),
  ],
)

/** The pending change to published content (K-074), at most one per item, optionally part of a release. */
export const contentDraft = pgTable(
  'content_draft',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    /** Who saved it last. */
    accountId: uuid('account_id'),
    releaseId: uuid('release_id'),
    workflowState: text('workflow_state'),
    snapshot: jsonb('snapshot').$type<ContentSnapshot>().notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_content_draft_content_id').on(t.contentId),
    // The draft is worthless without its content.
    foreignKey({ name: 'fk_content_draft_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // The draft stays when its last editor is deleted.
    foreignKey({ name: 'fk_content_draft_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    // A deleted release leaves its drafts as ordinary pending drafts.
    foreignKey({ name: 'fk_content_draft_release_id', columns: [t.releaseId], foreignColumns: [release.id] }).onDelete(
      'set null',
    ),
    index('idx_content_draft_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
    index('idx_content_draft_release_id')
      .on(t.releaseId)
      .where(sql`${t.releaseId} is not null`),
  ],
)

/** One autosave per user and item, overwritten every 30 seconds (K-073). */
export const contentAutosave = pgTable(
  'content_autosave',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    accountId: uuid('account_id').notNull(),
    snapshot: jsonb('snapshot').$type<ContentSnapshot>().notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_content_autosave_content_id_account_id').on(t.contentId, t.accountId),
    // Autosaves go with the content.
    foreignKey({
      name: 'fk_content_autosave_content_id',
      columns: [t.contentId],
      foreignColumns: [content.id],
    }).onDelete('cascade'),
    // ... and with the user who made them.
    foreignKey({
      name: 'fk_content_autosave_account_id',
      columns: [t.accountId],
      foreignColumns: [account.id],
    }).onDelete('cascade'),
    index('idx_content_autosave_account_id').on(t.accountId),
  ],
)

/** A snapshot taken on save and on publish (K-072); the service keeps the newest 25 per item by default. Append-only. */
export const contentRevision = pgTable(
  'content_revision',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    /** Who made the change. */
    accountId: uuid('account_id'),
    snapshot: jsonb('snapshot').$type<ContentSnapshot>().notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Revisions go with the content.
    foreignKey({
      name: 'fk_content_revision_content_id',
      columns: [t.contentId],
      foreignColumns: [content.id],
    }).onDelete('cascade'),
    // History stays when its author is deleted.
    foreignKey({
      name: 'fk_content_revision_account_id',
      columns: [t.accountId],
      foreignColumns: [account.id],
    }).onDelete('set null'),
    // The revision list and the prune to 25, newest first.
    index('idx_content_revision_content_id_created_at').on(t.contentId, t.createdAt),
    index('idx_content_revision_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/** Who is editing an item (K-046, WordPress _edit_lock). A lock whose heartbeat is old can be taken over. */
export const contentLock = pgTable(
  'content_lock',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    accountId: uuid('account_id').notNull(),
    heartbeatAt: timestamptz('heartbeat_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_content_lock_content_id').on(t.contentId),
    // A lock goes with its content ...
    foreignKey({ name: 'fk_content_lock_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // ... and with the user holding it.
    foreignKey({ name: 'fk_content_lock_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'cascade',
    ),
    index('idx_content_lock_account_id').on(t.accountId),
  ],
)

/**
 * What a content item links to or uses: other content, media or an outside URL (K-122, K-320, K-045). Derived from the
 * blocks and rebuilt by the content service on every save, so the rows are replaced, never edited.
 */
export const contentRef = pgTable(
  'content_ref',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    kind: text('kind').notNull(),
    targetContentId: uuid('target_content_id'),
    targetMediaId: uuid('target_media_id'),
    targetUrl: text('target_url'),
    /** The block that holds the reference. */
    blockId: text('block_id'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_content_ref_kind', oneOf(t.kind, CONTENT_REF_KIND)),
    check('ck_content_ref_target', sql`num_nonnulls(${t.targetContentId}, ${t.targetMediaId}, ${t.targetUrl}) = 1`),
    // Derived rows: they go with the source ...
    foreignKey({ name: 'fk_content_ref_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // ... and with the target. The service reads them before a delete, to warn (K-122) and to purge the cache.
    foreignKey({
      name: 'fk_content_ref_target_content_id',
      columns: [t.targetContentId],
      foreignColumns: [content.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_content_ref_target_media_id',
      columns: [t.targetMediaId],
      foreignColumns: [media.id],
    }).onDelete('cascade'),
    index('idx_content_ref_content_id').on(t.contentId),
    // «Used on» for content and media, and the cascades.
    index('idx_content_ref_target_content_id')
      .on(t.targetContentId)
      .where(sql`${t.targetContentId} is not null`),
    index('idx_content_ref_target_media_id')
      .on(t.targetMediaId)
      .where(sql`${t.targetMediaId} is not null`),
  ],
)

/** A note on one block of a content item (K-098, WordPress 6.9 Notes). */
export const blockNote = pgTable(
  'block_note',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    blockId: text('block_id').notNull(),
    accountId: uuid('account_id'),
    body: text('body').notNull(),
    isResolved: boolean('is_resolved').notNull().default(false),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Notes go with the content.
    foreignKey({ name: 'fk_block_note_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // A note stays, without author, when its writer is deleted.
    foreignKey({ name: 'fk_block_note_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    index('idx_block_note_content_id').on(t.contentId),
    index('idx_block_note_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/** A template or template part made of blocks (K-103, WordPress wp_template and wp_template_part). */
export const template = pgTable(
  'template',
  {
    id: id(),
    /** The theme it belongs to (extension_state slug). */
    theme: text('theme').notNull(),
    type: text('type').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull().default(''),
    blocks: jsonb('blocks').$type<Blocks>().notNull().default([]),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_template_theme_type_slug').on(t.theme, t.type, t.slug),
    check('ck_template_type', oneOf(t.type, TEMPLATE_TYPE)),
  ],
)
