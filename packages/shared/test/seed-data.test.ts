// The constants seedCore() writes: built-in roles, capabilities and the core settings. The rows themselves are checked
// in packages/db/test/seed.test.ts.
import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_TOKEN_PURPOSE,
  AccountTokenPurpose,
  BUILT_IN_ROLES,
  CAPABILITIES,
  CORE_SETTINGS,
  CORE_SETTING_KEYS,
  Capability,
  CoreSettings,
  DEFAULT_ROLES,
  DEFAULT_TAXONOMIES,
  EncryptedValue,
  READ_ONLY_SETTING_KEYS,
  SETUP_EMAIL_SKIPPED_NOTICE,
  SITE_SECRET_PURPOSE,
  AdminNoticeLevel,
  BUILT_IN_TAXONOMIES,
} from '../src/index.ts'
import type { CoreSettingKey } from '../src/index.ts'

describe('built-in roles and capabilities', () => {
  it('lists the five WordPress roles with 50, 25, 7, 3 and 1 capabilities', () => {
    expect(DEFAULT_ROLES.map((r) => r.slug)).toEqual([...BUILT_IN_ROLES])
    expect(DEFAULT_ROLES.map((r) => [r.slug, r.name, r.capabilities.length])).toEqual([
      ['administrator', 'Administrator', 50],
      ['editor', 'Editor', 25],
      ['author', 'Author', 7],
      ['contributor', 'Contributor', 3],
      ['subscriber', 'Subscriber', 1],
    ])
  })

  it('has 50 distinct capabilities, the administrator holds all of them, and no role repeats one', () => {
    expect(new Set(CAPABILITIES).size).toBe(50)
    for (const r of DEFAULT_ROLES) {
      expect(new Set(r.capabilities).size, r.slug).toBe(r.capabilities.length)
    }
    expect([...(DEFAULT_ROLES[0]?.capabilities ?? [])].sort()).toEqual([...CAPABILITIES].sort())
  })

  it('gives each role a subset of the one above it, as WordPress does', () => {
    for (let i = 1; i < DEFAULT_ROLES.length; i += 1) {
      const above = new Set(DEFAULT_ROLES[i - 1]?.capabilities)
      for (const cap of DEFAULT_ROLES[i]?.capabilities ?? []) {
        expect(above.has(cap), `${DEFAULT_ROLES[i]?.slug ?? ''} ${cap}`).toBe(true)
      }
    }
  })

  it('gives unfiltered_html to the administrator only (Tor, M0.3)', () => {
    expect(DEFAULT_ROLES.filter((r) => r.capabilities.includes('unfiltered_html')).map((r) => r.slug)).toEqual([
      'administrator',
    ])
  })

  it('stores no deprecated level_* and no meta capability', () => {
    expect(CAPABILITIES.filter((c) => c.startsWith('level_'))).toEqual([])
    for (const meta of ['edit_post', 'delete_post', 'read_post', 'edit_user', 'edit_comment', 'manage_network']) {
      expect(Capability.safeParse(meta).success, meta).toBe(false)
    }
  })
})

describe('core settings', () => {
  it('every default parses with its key schema, and the whole set with CoreSettings', () => {
    for (const key of CORE_SETTING_KEYS) {
      expect(CoreSettings.shape[key].safeParse(CORE_SETTINGS[key]).success, key).toBe(true)
    }
    expect(CoreSettings.strict().parse(CORE_SETTINGS)).toEqual(CORE_SETTINGS)
    expect(Object.keys(CORE_SETTINGS).sort()).toEqual([...CORE_SETTING_KEYS].sort())
  })

  it("keeps Tor's choices: empty site title, nb, day-and-name permalinks, comments open", () => {
    expect(CORE_SETTINGS.blogname).toBe('')
    expect(CORE_SETTINGS.locale).toBe('nb')
    expect(CORE_SETTINGS.permalink_structure).toBe('/%year%/%monthnum%/%day%/%postname%/')
    expect(CORE_SETTINGS.default_comment_status).toBe('open')
  })

  it('stores booleans and numbers as such, never as WordPress strings', () => {
    expect(CORE_SETTINGS.users_can_register).toBe(false)
    expect(CORE_SETTINGS.posts_per_page).toBe(10)
    expect(CoreSettings.shape.posts_per_page.safeParse('10').success).toBe(false)
    expect(CoreSettings.shape.thread_comments.safeParse('1').success).toBe(false)
  })

  it('leaves out what toascribe drops, and siteurl and home (PUBLIC_ORIGIN is the address)', () => {
    for (const key of [
      'default_ping_status',
      'default_pingback_flag',
      'ping_sites',
      'mailserver_url',
      'siteurl',
      'home',
    ]) {
      expect(CORE_SETTING_KEYS, key).not.toContain(key)
    }
    expect(CORE_SETTING_KEYS).not.toContain('WPLANG')
  })

  it('refuses malformed values', () => {
    expect(CoreSettings.shape.locale.safeParse('nb_NO').success).toBe(false)
    expect(CoreSettings.shape.locale.safeParse('en-GB').success).toBe(true)
    expect(CoreSettings.shape.timezone_string.safeParse('Europe/Oslo').success).toBe(true)
    expect(CoreSettings.shape.timezone_string.safeParse('').success).toBe(true)
    expect(CoreSettings.shape.timezone_string.safeParse('oslo').success).toBe(false)
    expect(CoreSettings.shape.permalink_structure.safeParse('').success).toBe(true)
    expect(CoreSettings.shape.permalink_structure.safeParse('%postname%').success).toBe(false)
    expect(CoreSettings.shape.start_of_week.safeParse(7).success).toBe(false)
    expect(CoreSettings.shape.default_comment_status.safeParse('closed').success).toBe(true)
    expect(CoreSettings.shape.default_comment_status.safeParse('on').success).toBe(false)
  })
})

describe('M0.3 settings: login, sessions, privacy and e-mail', () => {
  /** Every numeric M0.3 setting with its default and bounds. The bounds are what keeps a limit from being turned off. */
  const BOUNDED: readonly (readonly [CoreSettingKey, number, number, number])[] = [
    ['session_lifetime_days', 2, 1, 30],
    ['session_lifetime_remember_days', 14, 1, 365],
    ['login_limit_account_attempts', 5, 1, 100],
    ['login_limit_ip_attempts', 20, 1, 1000],
    ['login_limit_window_minutes', 60, 5, 1440],
    ['login_limit_delay_seconds', 30, 1, 600],
    ['login_limit_delay_max_minutes', 15, 10, 1440],
    ['ip_retention_days', 90, 7, 3650],
    ['spam_comment_retention_days', 30, 1, 365],
  ]

  it.each(BOUNDED)('%s defaults to %d and accepts %d to %d, whole numbers only', (key, value, min, max) => {
    const schema = CoreSettings.shape[key]
    expect(CORE_SETTINGS[key]).toBe(value)
    expect(schema.safeParse(min).success).toBe(true)
    expect(schema.safeParse(max).success).toBe(true)
    expect(schema.safeParse(min - 1).success).toBe(false)
    expect(schema.safeParse(max + 1).success).toBe(false)
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse(-1).success).toBe(false)
    expect(schema.safeParse(min + 0.5).success).toBe(false)
    expect(schema.safeParse(null).success).toBe(false)
    expect(schema.safeParse(String(value)).success).toBe(false)
  })

  it('keeps the first wait at or below its cap for every pair of values the bounds allow', () => {
    const base = CoreSettings.shape.login_limit_delay_seconds
    const cap = CoreSettings.shape.login_limit_delay_max_minutes
    // The largest base (600 s = 10 minutes) is not above the smallest cap (10 minutes).
    expect(base.safeParse(601).success).toBe(false)
    expect(cap.safeParse(9).success).toBe(false)
  })

  it('no longer has the hard-lockout settings', () => {
    expect(Object.keys(CoreSettings.shape)).not.toContain('login_limit_lockout_minutes')
    expect(Object.keys(CoreSettings.shape)).not.toContain('login_limit_lockout_max_minutes')
  })

  it("sets Tor's session lifetimes and retention: 2 and 14 days, IPs 90 days, spam 30 days", () => {
    expect(CORE_SETTINGS).toMatchObject({
      session_lifetime_days: 2,
      session_lifetime_remember_days: 14,
      ip_retention_days: 90,
      spam_comment_retention_days: 30,
    })
  })

  it('requires two-factor for no role by default and takes role slugs only', () => {
    const schema = CoreSettings.shape.mfa_required_roles
    expect(CORE_SETTINGS.mfa_required_roles).toEqual([])
    expect(schema.safeParse(['administrator', 'editor']).success).toBe(true)
    expect(schema.safeParse(['Administrator']).success).toBe(false)
    expect(schema.safeParse('administrator').success).toBe(false)
  })

  it('refuses administrator as the default role (Tor)', () => {
    const schema = CoreSettings.shape.default_role
    expect(schema.safeParse('administrator').success).toBe(false)
    expect(schema.safeParse('subscriber').success).toBe(true)
    expect(schema.safeParse('editor').success).toBe(true)
    expect(CoreSettings.safeParse({ ...CORE_SETTINGS, default_role: 'administrator' }).success).toBe(false)
  })

  it('leaves the sender and SMTP to .env by default (null), and turns both admin notices on (K-017)', () => {
    for (const key of [
      'mail_from_address',
      'mail_from_name',
      'smtp_host',
      'smtp_port',
      'smtp_secure',
      'smtp_username',
      'smtp_password',
    ] as const) {
      expect(CORE_SETTINGS[key], key).toBeNull()
    }
    expect(CORE_SETTINGS.notify_admin_new_user).toBe(true)
    expect(CORE_SETTINGS.notify_admin_password_change).toBe(true)
  })

  it('validates the sender and SMTP values, and refuses line breaks that could inject mail headers', () => {
    const s = CoreSettings.shape
    expect(s.mail_from_address.safeParse('post@example.test').success).toBe(true)
    expect(s.mail_from_address.safeParse('not an address').success).toBe(false)
    expect(s.mail_from_name.safeParse('Min blogg').success).toBe(true)
    expect(s.mail_from_name.safeParse('Min blogg\r\nBcc: x@example.test').success).toBe(false)
    expect(s.mail_from_name.safeParse('').success).toBe(false)
    expect(s.smtp_username.safeParse('user\nx').success).toBe(false)
    expect(s.smtp_host.safeParse('smtp.example.test').success).toBe(true)
    expect(s.smtp_host.safeParse('192.0.2.1').success).toBe(true)
    expect(s.smtp_host.safeParse('2001:db8::1').success).toBe(true)
    expect(s.smtp_host.safeParse('smtp.example.test:25').success).toBe(false) // the port is smtp_port
    expect(s.smtp_host.safeParse('smtp example').success).toBe(false)
    expect(s.smtp_host.safeParse('smtp.example.test\r\n').success).toBe(false)
    expect(s.smtp_port.safeParse(587).success).toBe(true)
    expect(s.smtp_port.safeParse(0).success).toBe(false)
    expect(s.smtp_port.safeParse(65_536).success).toBe(false)
    for (const mode of ['none', 'starttls', 'tls']) {
      expect(s.smtp_secure.safeParse(mode).success, mode).toBe(true)
    }
    expect(s.smtp_secure.safeParse('ssl').success).toBe(false)
  })

  it('stores the SMTP password only as an encrypted value, never as plain text', () => {
    const s = CoreSettings.shape.smtp_password
    expect(s.safeParse('v1:AAECAwQ.BQYHCAk_-').success).toBe(true)
    expect(s.safeParse('hunter2').success).toBe(false)
    expect(s.safeParse('').success).toBe(false)
  })
})

describe('EncryptedValue', () => {
  it('accepts a versioned envelope of base64url segments', () => {
    for (const value of ['v1:AAEC', 'v1:AAEC.BQYH.CAkK', 'v2:key1:AAEC_-', 'v12:x']) {
      expect(EncryptedValue.safeParse(value).success, value).toBe(true)
    }
  })

  it('refuses plain text, a missing or zero version, other characters and very long values', () => {
    for (const value of [
      '',
      'v1:',
      'v0:AAEC',
      'V1:AAEC',
      '1:AAEC',
      'AAEC',
      'v1:AA EC',
      'v1:AA+/',
      'v1:AA==',
      'v1:a..b',
    ]) {
      expect(EncryptedValue.safeParse(value).success, value).toBe(false)
    }
    expect(EncryptedValue.safeParse(`v1:${'A'.repeat(4096)}`).success).toBe(false)
  })
})

describe('one-time link purposes', () => {
  it('are the three flows of M0.3', () => {
    expect(ACCOUNT_TOKEN_PURPOSE).toEqual(['password_reset', 'set_password', 'email_change'])
    expect(AccountTokenPurpose.safeParse('login').success).toBe(false)
  })
})

describe('M0.4 install settings, taxonomies and notices', () => {
  const UUID = '0199f3a0-0000-7000-8000-000000000000'

  it('starts uninstalled, with the installer-only options null', () => {
    expect(CORE_SETTINGS).toMatchObject({
      installed: false,
      installed_at: null,
      admin_email: null,
      default_category: null,
      wp_page_for_privacy_policy: null,
    })
  })

  it('takes a boolean flag and an ISO 8601 UTC time, nothing else', () => {
    const s = CoreSettings.shape
    expect(s.installed.safeParse(true).success).toBe(true)
    expect(s.installed.safeParse('true').success).toBe(false)
    expect(s.installed.safeParse(1).success).toBe(false)
    expect(s.installed_at.safeParse('2026-10-23T06:00:00.000Z').success).toBe(true)
    expect(s.installed_at.safeParse(null).success).toBe(true)
    expect(s.installed_at.safeParse('2026-10-23').success).toBe(false)
    expect(s.installed_at.safeParse('i går').success).toBe(false)
  })

  it('takes an e-mail address of at most 254 characters, and uuids for the category and the privacy page', () => {
    const s = CoreSettings.shape
    expect(s.admin_email.safeParse('admin@example.test').success).toBe(true)
    expect(s.admin_email.safeParse('admin').success).toBe(false)
    expect(s.admin_email.safeParse(`${'a'.repeat(64)}@${'b'.repeat(186)}.test`).success).toBe(false)
    for (const key of ['default_category', 'wp_page_for_privacy_policy'] as const) {
      expect(s[key].safeParse(UUID).success, key).toBe(true)
      expect(s[key].safeParse(null).success, key).toBe(true)
      expect(s[key].safeParse(3).success, key).toBe(false) // a WordPress post id
      expect(s[key].safeParse('ukategorisert').success, key).toBe(false)
    }
  })

  it('marks only the install flag and its time read-only', () => {
    expect([...READ_ONLY_SETTING_KEYS]).toEqual(['installed', 'installed_at'])
    for (const key of READ_ONLY_SETTING_KEYS) {
      expect(CORE_SETTING_KEYS).toContain(key)
    }
  })

  it('has no secret among the settings: those are site_secret rows', () => {
    expect(CORE_SETTING_KEYS.filter((k) => /token|recovery|secret/.test(k))).toEqual([])
    expect([...SITE_SECRET_PURPOSE]).toEqual(['setup_token', 'backup_recovery_key'])
  })

  it("lists WordPress' two built-in taxonomies, for posts, with English names", () => {
    expect(DEFAULT_TAXONOMIES.map((t) => t.slug)).toEqual([...BUILT_IN_TAXONOMIES])
    expect(DEFAULT_TAXONOMIES).toEqual([
      { slug: 'category', name: 'Categories', isHierarchical: true, contentTypes: ['post'] },
      { slug: 'post_tag', name: 'Tags', isHierarchical: false, contentTypes: ['post'] },
    ])
  })

  it('defines the skipped e-mail notice as a dismissible warning for administrators', () => {
    expect(SETUP_EMAIL_SKIPPED_NOTICE).toEqual({
      key: 'setup.email_skipped',
      level: 'warning',
      messageKey: 'notices.setupEmailSkipped',
      capability: 'manage_options',
      isDismissible: true,
    })
    expect(AdminNoticeLevel.safeParse(SETUP_EMAIL_SKIPPED_NOTICE.level).success).toBe(true)
  })
})
