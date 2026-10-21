import { z } from 'zod'

import { COMMENT_STATUS } from './values.ts'

// The core site settings: one `setting` row per key, value as JSON (PLAN «Innstillinger», app-config «settings first»).
// `CoreSettings` validates every key; `CORE_SETTINGS` holds the defaults that `seedCore()` in @toascribe/db writes on
// an empty database. After that the rows are the truth: the seed never overwrites a value an administrator changed.
//
// Keys are the WordPress option names, so the WXR importer and WordPress users recognise them. Mapping where toascribe
// differs from wp_options:
// - `WPLANG` (a legacy constant name, and `''` for en_US) is `locale`, a BCP 47 tag as the admin's i18n uses (`nb`).
// - Values are typed: WordPress' '0'/'1' strings are JSON booleans, its numeric strings are numbers.
// - `moderation_keys` and `disallowed_keys` (one word, e-mail or IP per line in WordPress) are string arrays.
// - `page_on_front`, `page_for_posts` and `site_icon` (a post id, 0 for none, in WordPress) are a content or media
//   uuid, null for none.
//
// Defaults are WordPress 7.1.3's install-time values (`populate_options()` in wp-admin/includes/schema.php), with
// these changes:
// - Tor: `blogname` is empty (WordPress: the installer's title), `locale` is `nb`, comments are open, and
//   `permalink_structure` is day and name, which the WordPress installer sets whenever pretty permalinks work.
// - WordPress' nb_NO translation (translate.wordpress.org, wp/dev and wp/dev/admin, read 2026-10-21): date format
//   `j. F Y`, time format `H:i`, week starting on Monday, time zone Europe/Oslo.
//
// Left out: the pingback, trackback and ping-service options and post-by-email (PLAN drops them), what only the
// installer knows (`admin_email`, `siteurl`, `home`: M0.4), the Writing page (`default_category` needs a term, M0.4
// or phase 1), and internal options that have no field on a settings page (`medium_large_size_*`, `fresh_site`, ...).
//
// Text and list bounds are against abuse, not WordPress limits.

const text = z.string().max(1000)
const wordList = z.array(z.string().min(1).max(1000))
const count = z.int().min(1)
const pixels = z.int().min(0)
/** A role slug, or another lower-case machine name. */
const machineName = z
  .string()
  .regex(/^[a-z0-9_-]+$/)
  .max(64)
/** A BCP 47 language tag: nb, nn, en, en-GB, pt-BR, zh-Hans. */
const locale = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-\d{3})?$/)
  .max(35)
/** An IANA time zone (Europe/Oslo, Etc/GMT+1), UTC, or empty when `gmt_offset` applies (WordPress «UTC+1»). */
const timezone = z
  .string()
  .regex(/^$|^UTC$|^[A-Z][A-Za-z_]*(\/[A-Za-z0-9_+-]+)+$/)
  .max(64)
/** A path segment without spaces, query or fragment; empty means WordPress' default (category, tag). */
const urlBase = z
  .string()
  .regex(/^[^\s?#]*$/)
  .max(200)

export const CoreSettings = z.object({
  // Settings → General
  blogname: text,
  blogdescription: text,
  site_icon: z.uuid().nullable(),
  users_can_register: z.boolean(),
  default_role: machineName,
  locale,
  timezone_string: timezone,
  /** Hours from UTC when `timezone_string` is empty; WordPress allows quarter hours (5.75). */
  gmt_offset: z.number().min(-12).max(14),
  /** PHP date() format characters, as WordPress. */
  date_format: z.string().min(1).max(100),
  time_format: z.string().min(1).max(100),
  /** 0 is Sunday, 1 Monday. */
  start_of_week: z.int().min(0).max(6),

  // Settings → Reading
  show_on_front: z.enum(['posts', 'page']),
  page_on_front: z.uuid().nullable(),
  page_for_posts: z.uuid().nullable(),
  posts_per_page: count,
  posts_per_rss: count,
  rss_use_excerpt: z.boolean(),
  /** False asks search engines not to index the site. */
  blog_public: z.boolean(),

  // Settings → Discussion
  default_comment_status: z.enum(COMMENT_STATUS),
  require_name_email: z.boolean(),
  comment_registration: z.boolean(),
  close_comments_for_old_posts: z.boolean(),
  close_comments_days_old: count,
  show_comments_cookies_opt_in: z.boolean(),
  thread_comments: z.boolean(),
  /** WordPress offers 2 to 10 levels (`thread_comments_depth_max`). */
  thread_comments_depth: z.int().min(1).max(10),
  page_comments: z.boolean(),
  comments_per_page: count,
  default_comments_page: z.enum(['newest', 'oldest']),
  comment_order: z.enum(['asc', 'desc']),
  comments_notify: z.boolean(),
  moderation_notify: z.boolean(),
  comment_moderation: z.boolean(),
  comment_previously_approved: z.boolean(),
  comment_max_links: z.int().min(0),
  moderation_keys: wordList,
  disallowed_keys: wordList,
  show_avatars: z.boolean(),
  avatar_rating: z.enum(['G', 'PG', 'R', 'X']),
  /** A built-in default picture (mystery, identicon, ...) or one an extension adds. */
  avatar_default: machineName,

  // Settings → Media
  thumbnail_size_w: pixels,
  thumbnail_size_h: pixels,
  thumbnail_crop: z.boolean(),
  medium_size_w: pixels,
  medium_size_h: pixels,
  large_size_w: pixels,
  large_size_h: pixels,
  uploads_use_yearmonth_folders: z.boolean(),

  // Settings → Permalinks
  /** Empty is WordPress' «Plain» (`/?p=123`); otherwise a path with structure tags (%year%, %postname%, ...). */
  permalink_structure: z
    .string()
    .regex(/^$|^\/\S*$/)
    .max(255),
  category_base: urlBase,
  tag_base: urlBase,
})
export type CoreSettings = z.infer<typeof CoreSettings>
export type CoreSettingKey = keyof CoreSettings

/** The default value of every core setting, written once by `seedCore()`. */
export const CORE_SETTINGS: CoreSettings = {
  // General
  blogname: '', // Tor (WordPress: the installer's title)
  blogdescription: '',
  site_icon: null,
  users_can_register: false,
  default_role: 'subscriber',
  locale: 'nb', // Tor (WordPress: WPLANG unset, en_US)
  timezone_string: 'Europe/Oslo', // nb_NO
  gmt_offset: 0,
  date_format: 'j. F Y', // nb_NO
  time_format: 'H:i', // nb_NO
  start_of_week: 1, // nb_NO and WordPress

  // Reading
  show_on_front: 'posts',
  page_on_front: null,
  page_for_posts: null,
  posts_per_page: 10,
  posts_per_rss: 10,
  rss_use_excerpt: false,
  blog_public: true,

  // Discussion
  default_comment_status: 'open', // Tor and WordPress
  require_name_email: true,
  comment_registration: false,
  close_comments_for_old_posts: false,
  close_comments_days_old: 14,
  show_comments_cookies_opt_in: true,
  thread_comments: true,
  thread_comments_depth: 5,
  page_comments: false,
  comments_per_page: 50,
  default_comments_page: 'newest',
  comment_order: 'asc',
  comments_notify: true,
  moderation_notify: true,
  comment_moderation: false,
  comment_previously_approved: true,
  comment_max_links: 2,
  moderation_keys: [],
  disallowed_keys: [],
  show_avatars: true,
  avatar_rating: 'G',
  avatar_default: 'mystery',

  // Media
  thumbnail_size_w: 150,
  thumbnail_size_h: 150,
  thumbnail_crop: true,
  medium_size_w: 300,
  medium_size_h: 300,
  large_size_w: 1024,
  large_size_h: 1024,
  uploads_use_yearmonth_folders: true,

  // Permalinks
  permalink_structure: '/%year%/%monthnum%/%day%/%postname%/', // Tor, as the WordPress installer sets it
  category_base: '',
  tag_base: '',
}

/** Every core setting key, in the order of the settings pages. */
export const CORE_SETTING_KEYS: readonly CoreSettingKey[] = CoreSettings.keyof().options
