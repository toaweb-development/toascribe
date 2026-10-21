// M0.3 data (migrations 0002_account_token_session and 0003_rights_ip_retention) against a real PostgreSQL 18
// (typescript §6): one-time links, the new session columns, the app role's DML for the worker's clean-up jobs, and the
// data migration that takes unfiltered_html from v0.2.0's editor and administrator from default_role.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CORE_SETTINGS, DEFAULT_ROLES } from '@toascribe/shared'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrator.ts'
import { APP_ROLE, TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('auth')

const logger = pino({ level: 'silent' })

/** The migrations v0.2.0 shipped. A database migrated by v0.2.0 has exactly these in its journal. */
const V0_2_0_MIGRATIONS = 2

const MIGRATION_ACTOR = 'migration 0003_rights_ip_retention'

/** The editor's capabilities as v0.2.0 seeded them: today's list with WordPress' unfiltered_html after upload_files. */
function v020EditorCapabilities(): string[] {
  const editor = DEFAULT_ROLES.find((r) => r.slug === 'editor')
  if (editor === undefined) {
    throw new Error('DEFAULT_ROLES has no editor')
  }
  const capabilities: string[] = [...editor.capabilities]
  capabilities.splice(capabilities.indexOf('upload_files') + 1, 0, 'unfiltered_html')
  return capabilities
}

/** A copy of the migrations folder with the journal cut after `count` entries: the migrations of an older release. */
async function migrationsUpTo(count: number): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'toascribe-migrations-'))
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal: unknown = JSON.parse(await readFile(journalPath, 'utf8'))
  if (typeof journal !== 'object' || journal === null || !('entries' in journal) || !Array.isArray(journal.entries)) {
    throw new Error('migrations/meta/_journal.json has no entries')
  }
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }))
  return folder
}

describe.skipIf(TEST_DATABASE_URL === undefined)('M0.3 auth data (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Pool
  let app: pg.Pool

  async function insert(table: string, values: Readonly<Record<string, unknown>>): Promise<string> {
    const columns = Object.keys(values)
    const params = columns.map((_, i) => `$${String(i + 1)}`)
    const { rows } = await app.query<{ id: string }>(
      `insert into ${table} (${columns.join(', ')}) values (${params.join(', ')}) returning id`,
      Object.values(values),
    )
    const row = rows[0]
    if (row === undefined) {
      throw new Error(`insert into ${table} returned no id`)
    }
    return row.id
  }

  let accounts = 0
  function newAccount(): Promise<string> {
    accounts += 1
    const name = `auth${String(accounts)}`
    return insert('account', {
      username: name,
      email: `${name}@example.test`,
      display_name: name,
      nicename: name,
      status: 'active',
    })
  }

  let tokens = 0
  function newToken(accountId: string, values: Readonly<Record<string, unknown>> = {}): Promise<string> {
    tokens += 1
    return insert('account_token', {
      account_id: accountId,
      purpose: 'password_reset',
      token_hash: `hash-${String(tokens)}`,
      expires_at: new Date(Date.now() + 86_400_000),
      ...values,
    })
  }

  async function count(table: string, where: string, values: readonly unknown[]): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`, [
      ...values,
    ])
    return rows[0]?.n ?? Number.NaN
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    app = new pg.Pool({ connectionString: database.appUrl, max: 2 })
    await runMigrations({ connectionString: database.ownerUrl, logger })
  })

  afterAll(async () => {
    try {
      await app.end()
      await owner.end()
    } finally {
      await database.drop()
    }
  })

  describe('account_token', () => {
    it('stores a link for each purpose, the new address only for an e-mail change', async () => {
      const a = await newAccount()
      expect(await sqlState(newToken(a, { purpose: 'password_reset' }))).toBeUndefined()
      expect(await sqlState(newToken(a, { purpose: 'set_password' }))).toBeUndefined()
      expect(await sqlState(newToken(a, { purpose: 'email_change', new_email: 'new@example.test' }))).toBeUndefined()
    })

    it('refuses an unknown purpose, an e-mail change without an address, and an address on another purpose', async () => {
      const a = await newAccount()
      expect(await sqlState(newToken(a, { purpose: 'login' }))).toBe('23514')
      expect(await sqlState(newToken(a, { purpose: 'email_change' }))).toBe('23514')
      expect(await sqlState(newToken(a, { purpose: 'password_reset', new_email: 'x@example.test' }))).toBe('23514')
      expect(await sqlState(newToken(a, { purpose: 'set_password', new_email: 'x@example.test' }))).toBe('23514')
    })

    it('needs an account, a purpose, a hash and an expiry', async () => {
      const a = await newAccount()
      expect(await sqlState(newToken(a, { purpose: null }))).toBe('23502')
      expect(await sqlState(newToken(a, { token_hash: null }))).toBe('23502')
      expect(await sqlState(newToken(a, { expires_at: null }))).toBe('23502')
      expect(await sqlState(newToken(a, { account_id: null }))).toBe('23502')
      expect(await sqlState(newToken(a, { account_id: '0199f3a0-0000-7000-8000-000000000000' }))).toBe('23503')
    })

    it('keeps every token hash unique, across purposes and accounts', async () => {
      const a = await newAccount()
      const b = await newAccount()
      await newToken(a, { token_hash: 'same-hash' })
      expect(await sqlState(newToken(a, { token_hash: 'same-hash', purpose: 'set_password' }))).toBe('23505')
      expect(await sqlState(newToken(b, { token_hash: 'same-hash' }))).toBe('23505')
    })

    it('starts unused, with both timestamps set', async () => {
      const a = await newAccount()
      const id = await newToken(a)
      const { rows } = await owner.query(
        `select used_at, created_at is not null as created, modified_at is not null as modified
           from account_token where id = $1`,
        [id],
      )
      expect(rows).toEqual([{ used_at: null, created: true, modified: true }])
    })

    it('goes with its account (CASCADE)', async () => {
      const a = await newAccount()
      await newToken(a)
      await newToken(a, { purpose: 'email_change', new_email: 'gone@example.test' })
      await app.query('delete from account where id = $1', [a])
      expect(await count('account_token', 'account_id = $1', [a])).toBe(0)
    })

    it('lets the app role mark a link used and the purge job delete expired ones', async () => {
      const a = await newAccount()
      const used = await newToken(a)
      const expired = await newToken(a, { expires_at: new Date(Date.now() - 1000) })
      const { rowCount: marked } = await app.query(
        'update account_token set used_at = now(), modified_at = now() where id = $1 and used_at is null',
        [used],
      )
      expect(marked).toBe(1)
      const { rowCount: again } = await app.query(
        'update account_token set used_at = now(), modified_at = now() where id = $1 and used_at is null',
        [used],
      )
      expect(again).toBe(0)
      await app.query('delete from account_token where expires_at < now()')
      expect(await count('account_token', 'id = $1', [expired])).toBe(0)
      expect(await count('account_token', 'id = $1', [used])).toBe(1)
    })

    it('has the lookup indexes for the account (and purpose) and for the purge', async () => {
      const { rows } = await owner.query<{ name: string; def: string }>(
        `select indexname as name, indexdef as def from pg_indexes where tablename = 'account_token' order by indexname`,
      )
      expect(rows.map((r) => r.name)).toEqual([
        'account_token_pkey',
        'idx_account_token_account_id_purpose',
        'idx_account_token_expires_at',
        'uq_account_token_token_hash',
      ])
      expect(rows.find((r) => r.name === 'idx_account_token_account_id_purpose')?.def).toContain(
        '(account_id, purpose)',
      )
    })
  })

  describe('session', () => {
    it('has mfa_verified_at (nullable timestamptz) and is_remembered (boolean, not null, default false)', async () => {
      const { rows } = await owner.query(
        `select column_name as name, data_type as type, is_nullable as nullable, column_default as "default"
           from information_schema.columns
          where table_schema = 'public' and table_name = 'session' and column_name in ('mfa_verified_at', 'is_remembered')
          order by column_name`,
      )
      expect(rows).toEqual([
        { name: 'is_remembered', type: 'boolean', nullable: 'NO', default: 'false' },
        { name: 'mfa_verified_at', type: 'timestamp with time zone', nullable: 'YES', default: null },
      ])
    })

    it('starts without a second factor and without «Remember me», and the app role can set both', async () => {
      const a = await newAccount()
      const id = await insert('session', {
        account_id: a,
        token_hash: `session-${a}`,
        expires_at: new Date(Date.now() + 86_400_000),
      })
      expect(
        (await owner.query('select mfa_verified_at, is_remembered from session where id = $1', [id])).rows,
      ).toEqual([{ mfa_verified_at: null, is_remembered: false }])
      await app.query('update session set mfa_verified_at = now(), modified_at = now() where id = $1', [id])
      expect(await count('session', 'id = $1 and mfa_verified_at is not null', [id])).toBe(1)
      expect(
        await sqlState(
          insert('session', {
            account_id: a,
            token_hash: `session2-${a}`,
            expires_at: new Date(),
            is_remembered: null,
          }),
        ),
      ).toBe('23502')
    })
  })

  describe('app role DML for the clean-up jobs', () => {
    it('can clear IPs on sessions, comments and app passwords, and delete login attempts, spam and old links', async () => {
      const { rows } = await owner.query<{ check: string; granted: boolean }>(
        `select t || ' ' || p as check, has_table_privilege($1, t, p) as granted
           from unnest(array['session', 'comment', 'app_password', 'login_attempt', 'account_token']) as t,
                unnest(array['SELECT', 'UPDATE', 'DELETE']) as p
          order by 1`,
        [APP_ROLE],
      )
      expect(rows.filter((r) => !r.granted)).toEqual([])
      expect(rows).toHaveLength(15)
    })

    it('runs the statements the worker will run', async () => {
      const a = await newAccount()
      const item = await insert('content', {
        type: 'post',
        locale: 'nb',
        slug: 'ip-retention',
        status: 'publish',
        comment_status: 'open',
      })
      const old = new Date(Date.now() - 100 * 86_400_000)
      const session = await insert('session', {
        account_id: a,
        token_hash: `old-${a}`,
        ip: '192.0.2.10',
        expires_at: new Date(Date.now() + 86_400_000),
        created_at: old,
      })
      const comment = await insert('comment', {
        content_id: item,
        body: 'Hei',
        status: 'approved',
        ip: '192.0.2.11',
        created_at: old,
      })
      const spam = await insert('comment', {
        content_id: item,
        body: 'Spam',
        status: 'spam',
        created_at: old,
        modified_at: old,
      })
      const attempt = await insert('login_attempt', { action: 'login', ip: '192.0.2.12', created_at: old })

      await app.query(`update session set ip = null where ip is not null and created_at < now() - interval '90 days'`)
      await app.query(`update comment set ip = null where ip is not null and created_at < now() - interval '90 days'`)
      await app.query(`delete from comment where status = 'spam' and modified_at < now() - interval '30 days'`)
      await app.query(`delete from login_attempt where created_at < now() - interval '90 days'`)

      expect(await count('session', 'id = $1 and ip is null', [session])).toBe(1)
      expect(await count('comment', 'id = $1 and ip is null', [comment])).toBe(1)
      expect(await count('comment', 'id = $1', [spam])).toBe(0)
      expect(await count('login_attempt', 'id = $1', [attempt])).toBe(0)
    })
  })

  describe('the new settings', () => {
    it('are seeded with their defaults, so an existing install gets them on its next migration run', async () => {
      const { rows } = await owner.query<{ key: string; value: unknown }>(
        `select key, value from setting where key = any($1) order by key`,
        [['ip_retention_days', 'session_lifetime_days', 'session_lifetime_remember_days', 'smtp_password']],
      )
      expect(rows).toEqual([
        { key: 'ip_retention_days', value: CORE_SETTINGS.ip_retention_days },
        { key: 'session_lifetime_days', value: 2 },
        { key: 'session_lifetime_remember_days', value: 14 },
        { key: 'smtp_password', value: null },
      ])
    })
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('upgrade from v0.2.0 (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Pool
  let oldMigrations: string

  async function capabilities(slug: string): Promise<string[]> {
    const { rows } = await owner.query<{ capabilities: string[] }>('select capabilities from role where slug = $1', [
      slug,
    ])
    return rows[0]?.capabilities ?? []
  }

  async function setting(key: string): Promise<unknown> {
    const { rows } = await owner.query<{ value: unknown }>('select value from setting where key = $1', [key])
    return rows[0]?.value
  }

  async function migrationEntries(): Promise<unknown[]> {
    const { rows } = await owner.query<Record<string, unknown>>(
      `select action, object_type, object_id, old_value, new_value, source, actor_type
         from audit_log where actor = $1 order by action`,
      [MIGRATION_ACTOR],
    )
    return rows
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    oldMigrations = await migrationsUpTo(V0_2_0_MIGRATIONS)
    // v0.2.0: its two migrations, then the state its seed and an administrator left. The run also seeds today's
    // defaults, so the editor row is put back to v0.2.0's list by hand.
    await runMigrations({ connectionString: database.ownerUrl, logger, migrationsFolder: oldMigrations })
    await owner.query(`update role set capabilities = $1 where slug = 'editor'`, [v020EditorCapabilities()])
    await owner.query(`update setting set value = '"administrator"'::jsonb where key = 'default_role'`)
    // An administrator gave the author unfiltered_html and an extra capability of an extension's.
    await owner.query(
      `update role set capabilities = capabilities || array['unfiltered_html', 'manage_forms'] where slug = 'author'`,
    )
    // A v0.2.0 database has none of the M0.3 settings yet.
    await owner.query(`delete from setting where key = any($1)`, [['ip_retention_days', 'session_lifetime_days']])
  })

  afterAll(async () => {
    try {
      await owner.end()
      await rm(oldMigrations, { recursive: true, force: true })
    } finally {
      await database.drop()
    }
  })

  it('starts from the v0.2.0 state', async () => {
    expect(await capabilities('editor')).toContain('unfiltered_html')
    expect(await setting('default_role')).toBe('administrator')
    const { rows } = await owner.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')
    expect(rows).toEqual([{ n: V0_2_0_MIGRATIONS }])
  })

  it('takes unfiltered_html from the editor and administrator from default_role, and leaves the rest alone', async () => {
    const authorBefore = await capabilities('author')
    const administratorBefore = await capabilities('administrator')
    await runMigrations({ connectionString: database.ownerUrl, logger })

    const editor = DEFAULT_ROLES.find((r) => r.slug === 'editor')
    expect(await capabilities('editor')).toEqual([...(editor?.capabilities ?? [])])
    expect(await setting('default_role')).toBe('subscriber')
    expect(await capabilities('author')).toEqual(authorBefore)
    expect(await capabilities('author')).toContain('unfiltered_html')
    expect(await capabilities('administrator')).toEqual(administratorBefore)
    expect(await capabilities('administrator')).toContain('unfiltered_html')
    expect(await setting('ip_retention_days')).toBe(90)
    expect(await setting('session_lifetime_days')).toBe(2)
  })

  it('writes both changes to the audit log as the system', async () => {
    const { rows } = await owner.query<{ id: string }>(`select id from role where slug = 'editor'`)
    expect(await migrationEntries()).toEqual([
      {
        action: 'role.capabilities_changed',
        object_type: 'role',
        object_id: rows[0]?.id,
        old_value: v020EditorCapabilities(),
        new_value: [...(DEFAULT_ROLES.find((r) => r.slug === 'editor')?.capabilities ?? [])],
        source: 'setup',
        actor_type: 'system',
      },
      {
        action: 'setting.updated',
        object_type: 'setting',
        object_id: 'default_role',
        old_value: 'administrator',
        new_value: 'subscriber',
        source: 'setup',
        actor_type: 'system',
      },
    ])
  })

  it('runs once: an editor given unfiltered_html again keeps it on the next run', async () => {
    await owner.query(
      `update role set capabilities = capabilities || array['unfiltered_html'], modified_at = now() where slug = 'editor'`,
    )
    await runMigrations({ connectionString: database.ownerUrl, logger })
    expect(await capabilities('editor')).toContain('unfiltered_html')
    expect(await migrationEntries()).toHaveLength(2)
  })
})
