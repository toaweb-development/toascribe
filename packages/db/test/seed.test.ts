// seedCore(): the built-in roles and the core settings, written by the migration step and never overwritten.
import { CAPABILITIES, CORE_SETTINGS, DEFAULT_ROLES, CoreSettings } from '@toascribe/shared'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runMigrations } from '../src/migrator.ts'
import { seedCore } from '../src/seed.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('seed')

const logger = pino({ level: 'silent' })

interface RoleRow {
  slug: string
  name: string
  capabilities: string[]
}

interface SettingRow {
  key: string
  value: unknown
  type: string
}

describe.skipIf(TEST_DATABASE_URL === undefined)('seedCore (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Pool
  let app: pg.Pool

  async function roles(): Promise<RoleRow[]> {
    const { rows } = await owner.query<RoleRow>('select slug, name, capabilities from role order by slug')
    return rows
  }

  async function settings(): Promise<SettingRow[]> {
    const { rows } = await owner.query<SettingRow>(
      'select key, value, jsonb_typeof(value) as type from setting order by key',
    )
    return rows
  }

  async function counts(): Promise<{ roles: number; settings: number }> {
    const { rows } = await owner.query<{ roles: number; settings: number }>(
      'select (select count(*)::int from role) as roles, (select count(*)::int from setting) as settings',
    )
    return rows[0] ?? { roles: Number.NaN, settings: Number.NaN }
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    app = new pg.Pool({ connectionString: database.appUrl, max: 2 })
    // The migration step seeds: nothing else runs before the first assertions.
    await runMigrations({ connectionString: database.ownerUrl, logger })
  })

  afterAll(async () => {
    // The pools exist as soon as the database does, so a failed migration still drops the database and its roles.
    try {
      await app.end()
      await owner.end()
    } finally {
      await database.drop()
    }
  })

  it('runMigrations() on an empty database leaves the five roles and every default setting', async () => {
    expect(await counts()).toEqual({ roles: 5, settings: Object.keys(CORE_SETTINGS).length })
    const { rows } = await owner.query<{ slug: string; n: number }>(
      'select slug, cardinality(capabilities) as n from role order by n desc',
    )
    expect(rows).toEqual([
      { slug: 'administrator', n: 50 },
      { slug: 'editor', n: 25 },
      { slug: 'author', n: 7 },
      { slug: 'contributor', n: 3 },
      { slug: 'subscriber', n: 1 },
    ])
  })

  it('stores exactly the capabilities of DEFAULT_ROLES, all of them core capabilities', async () => {
    const stored = await roles()
    const expected = DEFAULT_ROLES.map((r) => ({ slug: r.slug, name: r.name, capabilities: [...r.capabilities] }))
    expect(stored).toEqual(expected.sort((a, b) => a.slug.localeCompare(b.slug)))
    const known = new Set<string>(CAPABILITIES)
    for (const r of stored) {
      expect(
        r.capabilities.filter((c) => !known.has(c)),
        r.slug,
      ).toEqual([])
    }
  })

  it('stores every default as typed JSON that parses with its schema', async () => {
    const stored = await settings()
    expect(Object.fromEntries(stored.map((s) => [s.key, s.value]))).toEqual(CORE_SETTINGS)
    expect(CoreSettings.strict().parse(Object.fromEntries(stored.map((s) => [s.key, s.value])))).toEqual(CORE_SETTINGS)
    const types = Object.fromEntries(stored.map((s) => [s.key, s.type]))
    expect(types).toMatchObject({
      blogname: 'string',
      site_icon: 'null',
      users_can_register: 'boolean',
      posts_per_page: 'number',
      moderation_keys: 'array',
    })
    const { rows } = await owner.query<{ key: string; value: unknown }>(
      `select key, value from setting where key in ('blogname', 'locale', 'permalink_structure', 'default_comment_status')
        order by key`,
    )
    expect(rows).toEqual([
      { key: 'blogname', value: '' },
      { key: 'default_comment_status', value: 'open' },
      { key: 'locale', value: 'nb' },
      { key: 'permalink_structure', value: '/%year%/%monthnum%/%day%/%postname%/' },
    ])
  })

  it('a second run inserts nothing and changes no row', async () => {
    const before = { roles: await roles(), settings: await settings() }
    const { rows: stamps } = await owner.query<{ n: number }>(
      `select (select count(*)::int from role where modified_at <> created_at)
            + (select count(*)::int from setting where modified_at <> created_at) as n`,
    )
    expect(await seedCore(drizzle({ client: owner }))).toEqual({ roles: 0, settings: 0 })
    expect(await seedCore(drizzle({ client: owner }))).toEqual({ roles: 0, settings: 0 })
    expect({ roles: await roles(), settings: await settings() }).toEqual(before)
    expect(stamps).toEqual([{ n: 0 }])
  })

  it('never overwrites a changed setting or an edited role', async () => {
    await app.query(`update setting set value = '"Min blogg"'::jsonb, modified_at = now() where key = 'blogname'`)
    await app.query(`update setting set value = 'false'::jsonb, modified_at = now() where key = 'show_avatars'`)
    await app.query(
      `update role set capabilities = array['read', 'edit_posts'], name = 'Redaktør', modified_at = now()
        where slug = 'editor'`,
    )

    expect(await seedCore(drizzle({ client: owner }))).toEqual({ roles: 0, settings: 0 })

    const values = Object.fromEntries((await settings()).map((s) => [s.key, s.value]))
    expect(values).toMatchObject({ blogname: 'Min blogg', show_avatars: false })
    expect((await roles()).find((r) => r.slug === 'editor')).toEqual({
      slug: 'editor',
      name: 'Redaktør',
      capabilities: ['read', 'edit_posts'],
    })
  })

  it('puts back a deleted built-in role or setting, and runs as the app role (INSERT only)', async () => {
    await app.query(`delete from role where slug = 'subscriber'`)
    await app.query(`delete from setting where key in ('tag_base', 'site_icon')`)

    expect(await seedCore(drizzle({ client: app }))).toEqual({ roles: 1, settings: 2 })
    expect(await counts()).toEqual({ roles: 5, settings: Object.keys(CORE_SETTINGS).length })
    const { rows } = await owner.query<{ key: string; type: string }>(
      `select key, jsonb_typeof(value) as type from setting where key in ('site_icon', 'tag_base') order by key`,
    )
    expect(rows).toEqual([
      { key: 'site_icon', type: 'null' },
      { key: 'tag_base', type: 'string' },
    ])
  })

  it('rolls back the roles when the settings insert fails (one transaction)', async () => {
    await owner.query(`delete from role where slug = 'contributor'`)
    await owner.query(`delete from setting where key = 'tag_base'`)
    // A CHECK that only the seed's tag_base row breaks, so the second insert fails after the first succeeded.
    await owner.query(`alter table setting add constraint ck_setting_seed_test check (key <> 'tag_base')`)
    try {
      await expect(seedCore(drizzle({ client: owner }))).rejects.toThrow()
      expect((await roles()).map((r) => r.slug)).not.toContain('contributor')
    } finally {
      await owner.query('alter table setting drop constraint ck_setting_seed_test')
    }
    expect(await seedCore(drizzle({ client: owner }))).toEqual({ roles: 1, settings: 1 })
  })
})
