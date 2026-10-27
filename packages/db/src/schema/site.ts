// The site around the content: menus, widget areas, global sets, patterns, comments, settings, oEmbed cache,
// redirects and the 404 log.
import { sql } from 'drizzle-orm'
import { COMMENT_MODERATION, COMMENT_TYPE, REDIRECT_ORIGIN, REDIRECT_STATUS_CODE } from '@toascribe/shared'
import type { Blocks, GlobalSetFields, JsonValue, MenuItems, OembedData } from '@toascribe/shared'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'

import { account } from './accounts.ts'
import { MAX_KEY_URL_LENGTH, id, inet, oneOf, timestamps, timestamptz } from './columns.ts'
import { content } from './content.ts'

const maxKeyLength = sql.raw(String(MAX_KEY_URL_LENGTH))

/** A navigation menu, stored as one JSON tree (K-132). Theme locations map to menus in the theme's settings. */
export const menu = pgTable(
  'menu',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    items: jsonb('items').$type<MenuItems>().notNull().default([]),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_menu_slug').on(t.slug)],
)

/** A theme's widget area filled with blocks (K-133, phase 3). */
export const area = pgTable(
  'area',
  {
    id: id(),
    /** The theme that declares the area (extension_state slug). */
    theme: text('theme').notNull(),
    /** The area's key in the theme manifest. */
    key: text('key').notNull(),
    blocks: jsonb('blocks').$type<Blocks>().notNull().default([]),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_area_theme_key').on(t.theme, t.key)],
)

/** A global set of editable values, e.g. contact details or social links, available in every template (K-106). */
export const globalSet = pgTable(
  'global_set',
  {
    id: id(),
    /** The set's slug: what a theme and the «Globalt sett» block ask for. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** The set's blocks (M1.5), checked against each block's block.json as content is. */
    blocks: jsonb('blocks').$type<Blocks>().notNull().default([]),
    /** Typed fields (K-093, phase 2). */
    fields: jsonb('fields').$type<GlobalSetFields>().notNull().default({}),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_global_set_key').on(t.key)],
)

/** A pattern made in admin (K-082 to K-084, WordPress wp_block). Patterns from code are not stored. */
export const pattern = pgTable(
  'pattern',
  {
    id: id(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    blocks: jsonb('blocks').$type<Blocks>().notNull().default([]),
    /** A synced pattern is one shared copy; an unsynced one is copied into the content when inserted. */
    isSynced: boolean('is_synced').notNull().default(false),
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_pattern_slug').on(t.slug)],
)

/** A comment (WordPress wp_comments). Threaded through parent_id. */
export const comment = pgTable(
  'comment',
  {
    id: id(),
    contentId: uuid('content_id').notNull(),
    parentId: uuid('parent_id'),
    /** Set when a logged-in user wrote it. */
    accountId: uuid('account_id'),
    author: text('author').notNull().default(''),
    authorEmail: text('author_email').notNull().default(''),
    authorUrl: text('author_url').notNull().default(''),
    ip: inet('ip'),
    userAgent: text('user_agent').notNull().default(''),
    type: text('type').notNull().default('comment'),
    body: text('body').notNull(),
    status: text('status').notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    check('ck_comment_type', oneOf(t.type, COMMENT_TYPE)),
    check('ck_comment_status', oneOf(t.status, COMMENT_MODERATION)),
    // Comments go with their content, as wp_delete_post() deletes them. Trashing content does not touch them.
    foreignKey({ name: 'fk_comment_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    // Replies stay when a comment is deleted (WordPress moves them up a level; the service does that first).
    foreignKey({ name: 'fk_comment_parent_id', columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null'),
    // A comment stays, with its author name, when the account is deleted.
    foreignKey({ name: 'fk_comment_account_id', columns: [t.accountId], foreignColumns: [account.id] }).onDelete(
      'set null',
    ),
    // The approved comments of one item, and the moderation counts per item.
    index('idx_comment_content_id_status').on(t.contentId, t.status),
    index('idx_comment_parent_id')
      .on(t.parentId)
      .where(sql`${t.parentId} is not null`),
    index('idx_comment_account_id')
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
  ],
)

/** A site setting (WordPress wp_options), with a key validated by its Zod schema (K-190). */
export const setting = pgTable(
  'setting',
  {
    id: id(),
    key: text('key').notNull(),
    value: jsonb('value').$type<JsonValue>().notNull(),
    /** Loaded into the settings cache at start-up (WordPress autoload). */
    autoload: boolean('autoload').notNull().default(true),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [unique('uq_setting_key').on(t.key)],
)

/** Cached oEmbed responses (K-225). */
export const oembedCache = pgTable(
  'oembed_cache',
  {
    id: id(),
    url: text('url').notNull(),
    data: jsonb('data').$type<OembedData>().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_oembed_cache_url').on(t.url),
    check('ck_oembed_cache_url', sql`char_length(${t.url}) <= ${maxKeyLength}`),
  ],
)

/**
 * A redirect from a path (K-206, K-207). The target is a URL or path, or a content item, so a slug-change redirect
 * follows the item's current permalink. 410 Gone has no target.
 */
export const redirect = pgTable(
  'redirect',
  {
    id: id(),
    /** The path the visitor asked for, without the query string. */
    source: text('source').notNull(),
    target: text('target'),
    contentId: uuid('content_id'),
    statusCode: integer('status_code').notNull().default(301),
    origin: text('origin').notNull().default('manual'),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('uq_redirect_source').on(t.source),
    check('ck_redirect_source', sql`char_length(${t.source}) <= ${maxKeyLength}`),
    check('ck_redirect_status_code', oneOf(t.statusCode, REDIRECT_STATUS_CODE)),
    check('ck_redirect_origin', oneOf(t.origin, REDIRECT_ORIGIN)),
    check(
      'ck_redirect_target',
      sql`case when ${t.statusCode} = 410 then ${t.target} is null and ${t.contentId} is null else num_nonnulls(${t.target}, ${t.contentId}) = 1 end`,
    ),
    // A redirect to deleted content has nowhere to go.
    foreignKey({ name: 'fk_redirect_content_id', columns: [t.contentId], foreignColumns: [content.id] }).onDelete(
      'cascade',
    ),
    index('idx_redirect_content_id')
      .on(t.contentId)
      .where(sql`${t.contentId} is not null`),
  ],
)

/** Paths that answered 404, one row per path with a hit count (K-206). No IP or user agent is kept. */
export const notFoundLog = pgTable(
  'not_found_log',
  {
    id: id(),
    path: text('path').notNull(),
    hits: bigint('hits', { mode: 'number' }).notNull().default(1),
    lastReferrer: text('last_referrer'),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    // Also the lookup by path (INSERT ... ON CONFLICT (path) DO UPDATE SET hits = hits + 1).
    unique('uq_not_found_log_path').on(t.path),
    check('ck_not_found_log_path', sql`char_length(${t.path}) <= ${maxKeyLength}`),
  ],
)
