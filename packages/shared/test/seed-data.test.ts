// The constants seedCore() writes: built-in roles, capabilities and the core settings. The rows themselves are checked
// in packages/db/test/seed.test.ts.
import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_ROLES,
  CAPABILITIES,
  CORE_SETTINGS,
  CORE_SETTING_KEYS,
  Capability,
  CoreSettings,
  DEFAULT_ROLES,
} from '../src/index.ts'

describe('built-in roles and capabilities', () => {
  it('lists the five WordPress roles with 50, 26, 7, 3 and 1 capabilities', () => {
    expect(DEFAULT_ROLES.map((r) => r.slug)).toEqual([...BUILT_IN_ROLES])
    expect(DEFAULT_ROLES.map((r) => [r.slug, r.name, r.capabilities.length])).toEqual([
      ['administrator', 'Administrator', 50],
      ['editor', 'Editor', 26],
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

  it('leaves out what toascribe drops and what only the installer knows', () => {
    for (const key of ['default_ping_status', 'default_pingback_flag', 'ping_sites', 'mailserver_url', 'admin_email']) {
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
