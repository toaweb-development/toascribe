import { z } from 'zod'

import { EncryptedValue } from './encrypted.ts'
import { COMMENT_STATUS, MediaGroup } from './values.ts'

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
//   `permalink_structure` is «Innleggsnavn» (Tor, M1.5; the WordPress installer sets day and name).
// - WordPress' nb_NO translation (translate.wordpress.org, wp/dev and wp/dev/admin, read 2026-10-21): date format
//   `j. F Y`, time format `H:i`, week starting on Monday, time zone Europe/Oslo.
//
// Left out: the pingback, trackback and ping-service options and post-by-email (PLAN drops them), `siteurl` and `home`
// (the site's address is PUBLIC_ORIGIN in .env, M0.4: one source of truth, which the proxy and the cookies need before
// the database is read), the rest of the Writing page (phase 1), and internal options that have no field on a settings
// page (`medium_large_size_*`, `fresh_site`, ...).
//
// Installation (M0.4): `admin_email`, `default_category` and `wp_page_for_privacy_policy` are WordPress options that the
// install writes (null until then). `installed` and `installed_at` are toascribe's own: the flag that closes /setup
// (PLAN «Installasjon og drift»: «låses med et flagg i databasen»). They are in READ_ONLY_SETTING_KEYS: only the install
// service writes them, never a settings page, `toa option` or an import, because `installed = false` would reopen /setup
// to anyone holding a setup token. `smtp_verified_at` is read-only for the same reason: it is what lets the wizard's e-mail
// step count as done and what the dashboard's «e-post ikke testet» notice reads. Its one writer is `markEmailVerified` in
// @toascribe/install, which the worker calls after it has sent a test mail (the wizard's and the dashboard's alike); the wizard's
// own save of the e-mail step clears it. A test reads the sources and fails if anything else writes it. Secrets of the install (the setup token, the recovery key) are not settings at all:
// they are hashes in the `site_secret` table, which no settings reader sees.
//
// toascribe's own keys, which WordPress has no option for (M0.3, PLAN «Innlogging og kontoer»; Tor 2026-10-21): session
// lifetimes, login limits, two-factor per role, IP and spam retention, the mail sender and SMTP, and the admin notices.
// Each is a setting with a safe default, and every number has a lower and an upper bound, so no value an administrator
// can save turns a limit off or keeps personal data for ever (app-config «Settings-først»). The SMTP keys and
// `mail_from_address` are null by default: null means «use the default from .env».
//
// Text and list bounds are against abuse, not WordPress limits.

/** How the SMTP connection is protected: plain, upgraded with STARTTLS (and never sent without it), or TLS from the first byte. */
export const SMTP_SECURE_MODES = ['none', 'starttls', 'tls'] as const
export type SmtpSecureMode = (typeof SMTP_SECURE_MODES)[number]

const text = z.string().max(1000)
const wordList = z.array(z.string().min(1).max(1000))
const count = z.int().min(1)
const pixels = z.int().min(0)
/** A role slug, or another lower-case machine name. */
const machineName = z
  .string()
  .regex(/^[a-z0-9_-]+$/)
  .max(64)
/** One line of text: no control characters, so a value cannot break a mail header (CR/LF injection). */
const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u)
/** A host name or an IP address, as nodemailer takes it (smtp.example.com, 192.0.2.1, 2001:db8::1). */
const host = z
  .string()
  .max(253)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$|^[0-9A-Fa-f:.]+$/)
/** A whole number of minutes or days between two bounds. */
const between = (min: number, max: number) => z.int().min(min).max(max)
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

/** Maintenance mode as stored (K-288): on or off, the message for visitors, how long to wait (seconds), and since when. */
export const MaintenanceMode = z.object({
  enabled: z.boolean(),
  message: z.string().max(500),
  retryAfter: z.int().min(30).max(86_400),
  since: z.iso.datetime().nullable(),
})
export type MaintenanceMode = z.infer<typeof MaintenanceMode>

export const CoreSettings = z.object({
  // Settings → General
  blogname: text,
  blogdescription: text,
  site_icon: z.uuid().nullable(),
  /** «Tilpass → Nettstedsidentitet» (M1.5): the logo, an image in the media library. */
  site_logo: z.uuid().nullable(),
  /** The administration e-mail address (WordPress: the first administrator's, set by the installer). Null until installed. */
  admin_email: z.email().max(254).nullable(),
  users_can_register: z.boolean(),
  /** The role a registered account gets. Never `administrator` (Tor): registration must not hand out the site. */
  default_role: machineName.refine((slug) => slug !== 'administrator', {
    message: 'the default role cannot be administrator',
  }),
  locale,
  timezone_string: timezone,
  /** Hours from UTC when `timezone_string` is empty; WordPress allows quarter hours (5.75). */
  gmt_offset: z.number().min(-12).max(14),
  /** PHP date() format characters, as WordPress. */
  date_format: z.string().min(1).max(100),
  time_format: z.string().min(1).max(100),
  /** 0 is Sunday, 1 Monday. */
  start_of_week: z.int().min(0).max(6),

  // Settings → Writing
  /** The category a post gets when it has none (WordPress: «Ukategorisert», made by the installer). A term uuid. */
  default_category: z.uuid().nullable(),
  /** The post format a new post starts with (WordPress' «Standard innleggsformat»). Only «Standard» until post formats come. */
  default_post_format: z.enum(['standard']),

  // Settings → Reading
  show_on_front: z.enum(['posts', 'page']),
  page_on_front: z.uuid().nullable(),
  page_for_posts: z.uuid().nullable(),
  posts_per_page: count,
  posts_per_rss: count,
  rss_use_excerpt: z.boolean(),
  /** False asks search engines not to index the site. */
  blog_public: z.boolean(),
  // «Deling og søkemotorer» (M1.6, K-224), on the same screen: the sharing image when an item has neither its own nor a featured
  // image, and who publishes the site in its structured data (an organisation with a name and logo, or one person).
  seo_default_image: z.uuid().nullable(),
  seo_publisher_type: z.enum(['organization', 'person']),
  /** The organisation's name; empty: the site's title. */
  seo_publisher_name: z.string().max(200),
  /** The organisation's logo; null: the logo from «Tilpass». */
  seo_publisher_logo: z.uuid().nullable(),
  /** The person (an account); null with `person`: no publisher is named. */
  seo_publisher_person: z.uuid().nullable(),

  /**
   * Maintenance mode (M1.7, K-288): visitors get 503 with Retry-After and the maintenance page; accounts with manage_options see
   * the site. Set by `toa maintenance`, and by a restore or a migration while it runs.
   */
  maintenance_mode: MaintenanceMode,

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
  /**
   * toascribe's own (M1.2, K-117): the largest file one upload may be, in megabytes. The api also refuses a value above its own cap
   * (UPLOAD_MAX_SIZE_MB in .env), which the proxy enforces too.
   */
  upload_max_size_mb: z.int().min(1).max(4096),
  /** toascribe's own (K-125): images with more pixels are refused before they are decoded (a guard against decompression bombs). */
  image_max_pixels: z.int().min(1_000_000).max(1_000_000_000),
  /** toascribe's own (K-125): the file groups a role may upload; a role not named may upload every allowed type. */
  upload_groups_by_role: z.record(machineName, z.array(MediaGroup).max(7)),

  // Settings → Permalinks
  /** Empty is WordPress' «Plain» (`/?p=123`); otherwise a path with structure tags (%year%, %postname%, ...). */
  permalink_structure: z
    .string()
    .regex(/^$|^\/\S*$/)
    .max(255),
  category_base: urlBase,
  tag_base: urlBase,
  /**
   * The structures and bases the site had before (M1.5, newest first, at most ten): an address made under one of them is read and
   * sent on to the post's address now with 301, so a change of structure breaks no link (K-207).
   */
  permalink_history: z
    .array(z.strictObject({ structure: z.string().max(255), category_base: urlBase, tag_base: urlBase }))
    .max(10),

  // Appearance → Menus (M1.5): a theme location's slug → the menu shown there (WordPress' nav_menu_locations).
  menu_locations: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), z.uuid().nullable()),

  // Settings → Privacy
  /** The privacy policy page (WordPress: the draft «Personvernerklæring» the installer makes). A content uuid. */
  wp_page_for_privacy_policy: z.uuid().nullable(),
  // «Innbygginger» on the same screen (M1.6, K-225): a player from another service is loaded only after a click (on by default),
  // and the Mastodon instances whose posts may be embedded (they cannot be listed in advance).
  embed_click_to_load: z.boolean(),
  oembed_mastodon_instances: z.array(z.string().max(253)).max(50),

  // Installation (M0.4), read-only: see READ_ONLY_SETTING_KEYS
  /** True once the install transaction has committed. /setup and every setup endpoint answer 404 from then on. */
  installed: z.boolean(),
  /** When it was installed, as an ISO 8601 UTC timestamp; null before. */
  installed_at: z.iso.datetime().nullable(),

  // Login and sessions (M0.3)
  /** Session lifetime without «Remember me», in days (WordPress: 2). */
  session_lifetime_days: between(1, 30),
  /** Session lifetime with «Remember me», in days (WordPress: 14). */
  session_lifetime_remember_days: between(1, 365),
  /**
   * Failed attempts per login name (and per account) inside the window that are answered at once. The next one has to
   * wait (see `login_limit_delay_seconds`). Nothing is ever locked: the wait grows with the failures of the window and
   * shrinks by itself as they age out. At most 100: NIST SP 800-63B §5.2.2 lets a verifier allow no more than 100
   * consecutive failures.
   */
  login_limit_account_attempts: between(1, 100),
  /** The same per IP address. Higher, as one address may be many people. */
  login_limit_ip_attempts: between(1, 1000),
  /**
   * How long a failure counts, in minutes. The wait never exceeds what is left of the window, so the window is also the
   * longest an attacker is remembered.
   */
  login_limit_window_minutes: between(5, 1440),
  /**
   * The first wait, in seconds, when the free attempts are used up. Each failure after that doubles it, up to
   * `login_limit_delay_max_minutes`. The bounds keep the base (at most 10 minutes) at or below the cap (at least 10), so no
   * pair of saved values can make the cap the smaller one.
   */
  login_limit_delay_seconds: between(1, 600),
  /** The longest wait the doubling reaches, in minutes. */
  login_limit_delay_max_minutes: between(10, 1440),
  /** Role slugs whose accounts must use a second factor (K-023). Empty: two-factor is optional for everyone. */
  mfa_required_roles: z.array(machineName).max(100),

  // Privacy (M0.3)
  /**
   * Days an IP address is kept, for sessions, comments, login attempts and the audit log alike. At least 7: the audit
   * log's clean-up function enforces the same floor in SQL, whatever the row holds.
   */
  ip_retention_days: between(7, 3650),
  /** Days a comment marked as spam is kept before it is deleted. */
  spam_comment_retention_days: between(1, 365),

  // E-mail (M0.3)
  /** The From address of mail the site sends; null uses the default from .env. */
  mail_from_address: z.email().max(254).nullable(),
  /** The From name; null uses `blogname`. */
  mail_from_name: line(200).nullable(),
  smtp_host: host.nullable(),
  smtp_port: between(1, 65_535).nullable(),
  /** `none` is plain SMTP, `starttls` upgrades the connection, `tls` connects with TLS (port 465). */
  smtp_secure: z.enum(SMTP_SECURE_MODES).nullable(),
  smtp_username: line(320).nullable(),
  /** Encrypted with the site key, never plain text, and never sent back to a client (app-config 3b). */
  smtp_password: EncryptedValue.nullable(),
  /**
   * When a test mail went through with exactly the SMTP settings now saved (M0.4, read-only: only the install service writes
   * it). The setup wizard's e-mail step counts as done on this or on the skip notice, never on the saved host alone; saving
   * the SMTP settings again clears it. Null: never verified, or changed since.
   */
  smtp_verified_at: z.iso.datetime().nullable(),
  /** E-mail the administrators when an account is registered or made (K-017). */
  notify_admin_new_user: z.boolean(),
  /** E-mail the administrators when a user changes or resets a password (K-017). */
  notify_admin_password_change: z.boolean(),
})
export type CoreSettings = z.infer<typeof CoreSettings>
export type CoreSettingKey = keyof CoreSettings

/** The default value of every core setting, written once by `seedCore()`. */
export const CORE_SETTINGS: CoreSettings = {
  // General
  blogname: '', // Tor (WordPress: the installer's title)
  blogdescription: '',
  site_icon: null,
  site_logo: null,
  admin_email: null, // set by the install
  users_can_register: false,
  default_role: 'subscriber',
  locale: 'nb', // Tor (WordPress: WPLANG unset, en_US)
  timezone_string: 'Europe/Oslo', // nb_NO
  gmt_offset: 0,
  date_format: 'j. F Y', // nb_NO
  time_format: 'H:i', // nb_NO
  start_of_week: 1, // nb_NO and WordPress

  // Writing
  default_category: null, // set by the install («Ukategorisert»)
  default_post_format: 'standard',

  // Reading
  show_on_front: 'posts',
  page_on_front: null,
  page_for_posts: null,
  posts_per_page: 10,
  posts_per_rss: 10,
  rss_use_excerpt: false,
  blog_public: true,
  seo_default_image: null,
  seo_publisher_type: 'organization',
  seo_publisher_name: '',
  seo_publisher_logo: null,
  seo_publisher_person: null,

  maintenance_mode: { enabled: false, message: '', retryAfter: 600, since: null },

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
  upload_max_size_mb: 64, // the M1.2 brief
  image_max_pixels: 100_000_000, // 100 megapixels: far above a phone camera's 50, far below what fills the worker's memory
  upload_groups_by_role: {}, // every role that may upload takes every allowed type

  // Permalinks
  permalink_structure: '/%postname%/', // Tor, M1.5: «Innleggsnavn (standard)»
  category_base: '',
  tag_base: '',
  permalink_history: [],
  menu_locations: {},

  // Privacy
  wp_page_for_privacy_policy: null, // set by the install (the draft privacy page)
  embed_click_to_load: true,
  oembed_mastodon_instances: [],

  // Installation
  installed: false,
  installed_at: null,

  // Login and sessions
  session_lifetime_days: 2, // Tor, as WordPress
  session_lifetime_remember_days: 14, // Tor, as WordPress
  // No hard lock (Tor, 2026-10-22): 5 tries per login name and 20 per address answer at once, which leaves room for typing
  // errors and for many people behind one NAT; then 30 s, 1, 2, 4, 8 minutes, and 15 minutes at most, forgotten after an hour.
  login_limit_account_attempts: 5,
  login_limit_ip_attempts: 20,
  login_limit_window_minutes: 60,
  login_limit_delay_seconds: 30,
  login_limit_delay_max_minutes: 15,
  mfa_required_roles: [],

  // Privacy
  ip_retention_days: 90, // Tor
  spam_comment_retention_days: 30, // Tor

  // E-mail
  mail_from_address: null,
  mail_from_name: null,
  smtp_host: null,
  smtp_port: null,
  smtp_secure: null,
  smtp_username: null,
  smtp_password: null,
  smtp_verified_at: null,
  notify_admin_new_user: true, // K-017
  notify_admin_password_change: true, // K-017
}

/** Every core setting key, in the order of the settings pages. */
export const CORE_SETTING_KEYS: readonly CoreSettingKey[] = CoreSettings.keyof().options

/**
 * Settings that only the install package writes, under the install lock: `installed` and `installed_at` in the install
 * transaction, `smtp_verified_at` through `markEmailVerified` (called by the worker after a test mail) and the wizard's e-mail
 * save. A settings API, `toa option` and an importer must refuse them; a settings API may still show them.
 */
export const READ_ONLY_SETTING_KEYS: readonly CoreSettingKey[] = ['installed', 'installed_at', 'smtp_verified_at']
