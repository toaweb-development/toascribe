// The core data model against a real PostgreSQL 18 (typescript §6): the migration, the PLAN table list, constraints,
// ON DELETE rules, the app role's privileges, and the shared value lists against the CHECKs in the database.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ACCOUNT_STATUS,
  ADMIN_NOTICE_LEVEL,
  ACCOUNT_TOKEN_PURPOSE,
  AUDIT_ACTOR_TYPE,
  AUDIT_SOURCE,
  BACKUP_STATUS,
  BACKUP_TARGET,
  BACKUP_TYPE,
  COMMENT_MODERATION,
  COMMENT_STATUS,
  COMMENT_TYPE,
  CONSENT_CATEGORY,
  CONTENT_REF_KIND,
  CONTENT_STATUS,
  CONTENT_STATUS_BEFORE_TRASH,
  EXTENSION_KIND,
  LOGIN_ATTEMPT_ACTION,
  MEDIA_VISIBILITY,
  MFA_CREDENTIAL_TYPE,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPE,
  REDIRECT_ORIGIN,
  REDIRECT_STATUS_CODE,
  RELEASE_STATUS,
  SITE_SECRET_PURPOSE,
  TEMPLATE_TYPE,
  WEBHOOK_DELIVERY_STATUS,
} from '@toascribe/shared'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrator.ts'
import * as schema from '../src/schema/index.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('schema')

/** PLAN «Datamodell i PostgreSQL», copied by hand: the schema and the database must both have exactly these. */
const PLAN_TABLES = [
  'account',
  'role',
  'account_role',
  'session',
  'app_password',
  'mfa_credential',
  'recovery_code',
  'login_attempt',
  'content',
  'content_type',
  'field_group',
  'content_author',
  'content_draft',
  'content_autosave',
  'content_revision',
  'content_lock',
  'content_ref',
  'block_note',
  'template',
  'taxonomy',
  'term',
  'content_term',
  'media',
  'media_folder',
  'media_term',
  'menu',
  'area',
  'global_set',
  'pattern',
  'comment',
  'setting',
  'oembed_cache',
  'redirect',
  'not_found_log',
  'webhook',
  'webhook_delivery',
  'release',
  'workflow',
  'extension_state',
  'backup',
  'audit_log',
  'privacy_request',
  'consent',
]

/** Tables added after PLAN's list, each with the decision that added it. */
const ADDED_TABLES = [
  // M0.3, Tor 2026-10-21: «Engangslenker lagres i en egen tabell».
  'account_token',
  // M0.4: the setup token's and the recovery key's hashes, out of `setting` so no settings reader can return them.
  'site_secret',
  // M0.4, Tor: «lagres et varsel som kontrollpanelet viser i M0.5».
  'admin_notice',
]

const TABLES = [...PLAN_TABLES, ...ADDED_TABLES].sort()

/** Every value-set CHECK in the database and the shared list it must equal. */
const VALUE_SET_CHECKS: Readonly<Record<string, readonly (string | number)[]>> = {
  ck_account_status: ACCOUNT_STATUS,
  ck_account_token_purpose: ACCOUNT_TOKEN_PURPOSE,
  ck_mfa_credential_type: MFA_CREDENTIAL_TYPE,
  ck_login_attempt_action: LOGIN_ATTEMPT_ACTION,
  ck_content_status: CONTENT_STATUS,
  ck_content_status_before_trash: CONTENT_STATUS_BEFORE_TRASH,
  ck_content_comment_status: COMMENT_STATUS,
  ck_content_ref_kind: CONTENT_REF_KIND,
  ck_template_type: TEMPLATE_TYPE,
  ck_media_visibility: MEDIA_VISIBILITY,
  ck_comment_type: COMMENT_TYPE,
  ck_comment_status: COMMENT_MODERATION,
  ck_redirect_status_code: REDIRECT_STATUS_CODE,
  ck_redirect_origin: REDIRECT_ORIGIN,
  ck_webhook_delivery_status: WEBHOOK_DELIVERY_STATUS,
  ck_release_status: RELEASE_STATUS,
  ck_extension_state_kind: EXTENSION_KIND,
  ck_backup_type: BACKUP_TYPE,
  ck_backup_target: BACKUP_TARGET,
  ck_backup_status: BACKUP_STATUS,
  ck_audit_log_actor_type: AUDIT_ACTOR_TYPE,
  ck_audit_log_source: AUDIT_SOURCE,
  ck_privacy_request_type: PRIVACY_REQUEST_TYPE,
  ck_privacy_request_status: PRIVACY_REQUEST_STATUS,
  ck_consent_category: CONSENT_CATEGORY,
  ck_site_secret_purpose: SITE_SECRET_PURPOSE,
  ck_admin_notice_level: ADMIN_NOTICE_LEVEL,
}

const logger = pino({ level: 'silent' })

/** Everything a migration could change in schema public, as one sorted list of lines. */
const CATALOGUE_SQL = `
  select 'relation ' || c.relname || ' ' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner)
         || ' acl=' || coalesce(c.relacl::text, '') as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all
  select 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull || ' identity=' || a.attidentity::text
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' acl=' || coalesce(a.attacl::text, '')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'function ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner)
         || ' secdef=' || p.prosecdef || ' config=' || coalesce(p.proconfig::text, '') || ' acl=' || coalesce(p.proacl::text, '')
         || ' body=' || md5(p.prosrc)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'migrations ' || count(*) from drizzle.__drizzle_migrations
  order by 1`

describe.skipIf(TEST_DATABASE_URL === undefined)('core data model (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Client
  let app: pg.Client
  let catalogueAfterFirstRun: string[]

  async function catalogue(): Promise<string[]> {
    return (await owner.query<{ line: string }>(CATALOGUE_SQL)).rows.map((r) => r.line)
  }

  /** Inserts as the app role, the way the api will, and returns the new id. */
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

  let accountCounter = 0
  function newAccount(name?: string): Promise<string> {
    accountCounter += 1
    const username = name ?? `user${String(accountCounter)}`
    return insert('account', {
      username,
      email: `${username}@example.test`,
      display_name: username,
      nicename: username,
      status: 'active',
    })
  }

  let slugCounter = 0
  function newContent(values: Readonly<Record<string, unknown>> = {}): Promise<string> {
    slugCounter += 1
    return insert('content', {
      type: 'post',
      locale: 'nb',
      slug: `item-${String(slugCounter)}`,
      status: 'draft',
      comment_status: 'open',
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
    await runMigrations({ connectionString: database.ownerUrl, logger })
    owner = new pg.Client({ connectionString: database.ownerUrl })
    app = new pg.Client({ connectionString: database.appUrl })
    await owner.connect()
    await app.connect()
    catalogueAfterFirstRun = await catalogue()
  })

  afterAll(async () => {
    await app.end()
    await owner.end()
    await database.drop()
  })

  describe('migration', () => {
    it('applies on an empty database, and a second run changes nothing in the catalogue', async () => {
      const journal: unknown = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'))
      const entries = typeof journal === 'object' && journal !== null && 'entries' in journal ? journal.entries : []
      expect(Array.isArray(entries) && entries.length > 3).toBe(true)
      expect(catalogueAfterFirstRun).toContain(`migrations ${String(Array.isArray(entries) ? entries.length : 0)}`)
      await runMigrations({ connectionString: database.ownerUrl, logger })
      expect(await catalogue()).toEqual(catalogueAfterFirstRun)
    })

    it('leaves every table and sequence in public owned by the owner role', async () => {
      const { rows } = await owner.query<{ owner: string }>(
        `select distinct pg_get_userbyid(relowner) as owner from pg_class
          where relnamespace = 'public'::regnamespace and relkind in ('r', 'S', 'i')`,
      )
      expect(rows).toEqual([{ owner: 'toascribe_owner' }])
    })
  })

  describe('tables', () => {
    const exports: readonly unknown[] = Object.values(schema)
    const schemaTables = exports.flatMap((value) => (is(value, PgTable) ? [getTableConfig(value).name] : [])).sort()

    it('exports nothing but tables from the schema', () => {
      expect(schemaTables).toHaveLength(exports.length)
    })

    it('the Drizzle schema has exactly the PLAN tables and the ones added since', () => {
      expect(schemaTables).toEqual(TABLES)
    })

    it('the database has exactly the PLAN tables and the ones added since in public', async () => {
      const { rows } = await owner.query<{ name: string }>(
        `select relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
          order by relname`,
      )
      expect(rows.map((r) => r.name)).toEqual(TABLES)
    })

    it('stores every timestamp as timestamptz', async () => {
      const { rows } = await owner.query<{ col: string }>(
        `select table_name || '.' || column_name as col from information_schema.columns
          where table_schema = 'public' and data_type = 'timestamp without time zone'`,
      )
      expect(rows).toEqual([])
    })

    it('gives every foreign key a name, an explicit ON DELETE and an index that starts with its column', async () => {
      const { rows } = await owner.query<{ name: string; action: string; indexed: boolean }>(
        `select c.conname as name, c.confdeltype as action,
                exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) as indexed
           from pg_constraint c
          where c.contype = 'f' and c.connamespace = 'public'::regnamespace
          order by c.conname`,
      )
      expect(rows.length).toBeGreaterThan(40)
      for (const row of rows) {
        expect(row.name).toMatch(/^fk_/)
        // a = NO ACTION, the default nobody chose.
        expect(['c', 'n', 'r'], row.name).toContain(row.action)
        expect(row.indexed, row.name).toBe(true)
      }
    })

    it('names every index and constraint by the convention', async () => {
      const { rows } = await owner.query<{ name: string; kind: string }>(
        `select conname as name, contype::text as kind from pg_constraint where connamespace = 'public'::regnamespace
         union all
         select i.relname, 'i' from pg_index x join pg_class i on i.oid = x.indexrelid
          where i.relnamespace = 'public'::regnamespace`,
      )
      const pattern: Readonly<Record<string, RegExp>> = {
        p: /^(pk_[a-z_]+|[a-z_]+_pkey)$/,
        u: /^uq_[a-z0-9_]+$/,
        f: /^fk_[a-z0-9_]+$/,
        c: /^ck_[a-z0-9_]+$/,
        i: /^(idx|uq|pk)_[a-z0-9_]+$|^[a-z_]+_pkey$/,
        // PostgreSQL 18 records NOT NULL as constraints too, named by itself.
        n: /^[a-z0-9_]+_not_null$/,
      }
      for (const row of rows) {
        expect(row.name, row.kind).toMatch(pattern[row.kind] ?? /^$/)
      }
    })
  })

  describe('value sets', () => {
    it('every shared list equals its CHECK in the database, and no value-set CHECK is unaccounted for', async () => {
      const { rows } = await owner.query<{ name: string; def: string }>(
        `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
          where contype = 'c' and connamespace = 'public'::regnamespace and pg_get_constraintdef(oid) like '%= ANY (ARRAY[%'`,
      )
      const found = Object.fromEntries(
        rows.map((row) => {
          const list = /ARRAY\[(.*)\]/.exec(row.def)?.[1] ?? ''
          const values = list.split(', ').map((item) => {
            const text = /^'(.*)'::text$/.exec(item)
            return text?.[1] ?? Number(item)
          })
          return [row.name, values]
        }),
      )
      expect(Object.keys(found).sort()).toEqual(Object.keys(VALUE_SET_CHECKS).sort())
      for (const [name, values] of Object.entries(VALUE_SET_CHECKS)) {
        expect(found[name], name).toEqual([...values])
      }
    })

    it('rejects a value outside the list', async () => {
      expect(await sqlState(newContent({ status: 'published' }))).toBe('23514')
      expect(await sqlState(newContent({ comment_status: 'maybe' }))).toBe('23514')
      expect(await sqlState(insert('media_folder', { name: 'ok' }))).toBeUndefined()
    })
  })

  describe('uniqueness', () => {
    it('allows one slug per type, locale and parent, also at the top level (parent null)', async () => {
      await newContent({ slug: 'about' })
      expect(await sqlState(newContent({ slug: 'about' }))).toBe('23505')
      // Another type, another locale or another parent may reuse it.
      expect(await sqlState(newContent({ slug: 'about', type: 'page' }))).toBeUndefined()
      expect(await sqlState(newContent({ slug: 'about', locale: 'en' }))).toBeUndefined()
      const parent = await newContent({ type: 'page', slug: 'company' })
      expect(await sqlState(newContent({ type: 'page', slug: 'about', parent_id: parent }))).toBeUndefined()
      expect(await sqlState(newContent({ type: 'page', slug: 'about', parent_id: parent }))).toBe('23505')
      // A trashed item keeps its slug in the constraint (the service renames it to <slug>__trashed).
      await newContent({ slug: 'gone', status: 'trash', status_before_trash: 'publish' })
      expect(await sqlState(newContent({ slug: 'gone' }))).toBe('23505')
    })

    it('keeps status_before_trash only on trashed content', async () => {
      expect(await sqlState(newContent({ status: 'trash' }))).toBe('23514')
      expect(await sqlState(newContent({ status: 'draft', status_before_trash: 'publish' }))).toBe('23514')
      expect(await sqlState(newContent({ status: 'trash', status_before_trash: 'trash' }))).toBe('23514')
    })

    it('treats usernames, e-mail addresses and nicenames that differ only in case as the same', async () => {
      const base = { display_name: 'X', status: 'active' }
      await insert('account', { ...base, username: 'Kari', email: 'kari@example.test', nicename: 'kari' })
      expect(
        await sqlState(insert('account', { ...base, username: 'KARI', email: 'k2@example.test', nicename: 'k2' })),
      ).toBe('23505')
      expect(
        await sqlState(insert('account', { ...base, username: 'kari2', email: 'Kari@Example.TEST', nicename: 'k3' })),
      ).toBe('23505')
      expect(
        await sqlState(insert('account', { ...base, username: 'kari3', email: 'k3@example.test', nicename: 'KARI' })),
      ).toBe('23505')
    })

    it('keeps one setting per key, one autosave per user and item, and one draft per item', async () => {
      await insert('setting', { key: 'general.title', value: JSON.stringify('Site') })
      expect(await sqlState(insert('setting', { key: 'general.title', value: JSON.stringify('Other') }))).toBe('23505')

      const author = await newAccount()
      const item = await newContent()
      await insert('content_autosave', { content_id: item, account_id: author, snapshot: '{}' })
      expect(await sqlState(insert('content_autosave', { content_id: item, account_id: author, snapshot: '{}' }))).toBe(
        '23505',
      )
      await insert('content_draft', { content_id: item, snapshot: '{}' })
      expect(await sqlState(insert('content_draft', { content_id: item, snapshot: '{}' }))).toBe('23505')
    })

    it('does not let two accounts link the same passkey or OIDC identity, but allows many TOTP apps', async () => {
      const a = await newAccount()
      const b = await newAccount()
      const oidc = { type: 'oidc', issuer: 'https://id.example.test', external_id: 'sub-1' }
      await insert('mfa_credential', { account_id: a, ...oidc })
      expect(await sqlState(insert('mfa_credential', { account_id: b, ...oidc }))).toBe('23505')
      await insert('mfa_credential', { account_id: a, type: 'totp', secret_encrypted: 'v1.x' })
      expect(
        await sqlState(insert('mfa_credential', { account_id: b, type: 'totp', secret_encrypted: 'v1.y' })),
      ).toBeUndefined()
      // TOTP needs its secret, and an identity needs issuer and external id.
      expect(await sqlState(insert('mfa_credential', { account_id: a, type: 'totp' }))).toBe('23514')
      expect(await sqlState(insert('mfa_credential', { account_id: a, type: 'passkey', external_id: 'c' }))).toBe(
        '23514',
      )
    })
  })

  describe('ON DELETE', () => {
    it('refuses to delete an account that still authors content (RESTRICT), and deletes it once reassigned', async () => {
      const author = await newAccount()
      const other = await newAccount()
      const item = await newContent()
      await app.query('insert into content_author (content_id, account_id) values ($1, $2)', [item, author])
      // 23001 restrict_violation: RESTRICT is checked at once, not at the end of the statement like NO ACTION.
      expect(await sqlState(app.query('delete from account where id = $1', [author]))).toBe('23001')

      await app.query('update content_author set account_id = $1 where account_id = $2', [other, author])
      await app.query('delete from account where id = $1', [author])
      expect(await count('content', 'id = $1', [item])).toBe(1)
    })

    it('deletes sessions, app passwords, second factors, recovery codes, autosaves and locks with the account', async () => {
      const gone = await newAccount()
      const item = await newContent()
      const future = new Date(Date.now() + 86_400_000)
      await insert('session', { account_id: gone, token_hash: `t-${gone}`, expires_at: future })
      await insert('app_password', { account_id: gone, name: 'ci', password_hash: 'h' })
      await insert('mfa_credential', { account_id: gone, type: 'totp', secret_encrypted: 'v1.z' })
      await insert('recovery_code', { account_id: gone, code_hash: 'c' })
      await insert('content_autosave', { content_id: item, account_id: gone, snapshot: '{}' })
      await insert('content_lock', { content_id: item, account_id: gone })

      await app.query('delete from account where id = $1', [gone])
      for (const table of [
        'session',
        'app_password',
        'mfa_credential',
        'recovery_code',
        'content_autosave',
        'content_lock',
      ]) {
        expect(await count(table, 'account_id = $1', [gone]), table).toBe(0)
      }
    })

    it('keeps audit_log rows and their actor when the account is deleted, without the link (SET NULL), even as the app role', async () => {
      const gone = await newAccount('leaver')
      const entry = await insert('audit_log', {
        account_id: gone,
        actor_type: 'account',
        actor: 'leaver',
        action: 'setting.updated',
        source: 'admin',
      })
      await app.query('delete from account where id = $1', [gone])
      const { rows } = await owner.query<{ account_id: string | null; actor: string }>(
        'select account_id, actor from audit_log where id = $1',
        [entry],
      )
      expect(rows).toEqual([{ account_id: null, actor: 'leaver' }])
    })

    it('deletes authors, drafts, autosaves, revisions, locks, refs, notes, terms and comments with the content', async () => {
      const author = await newAccount()
      const item = await newContent()
      const linked = await newContent()
      const taxonomy = await insert('taxonomy', { slug: `tax-${item}`, name: 'Tax' })
      const term = await insert('term', { taxonomy_id: taxonomy, slug: 'news', name: 'News' })
      await app.query('insert into content_author (content_id, account_id) values ($1, $2)', [item, author])
      await app.query('insert into content_term (content_id, term_id) values ($1, $2)', [item, term])
      await insert('content_draft', { content_id: item, snapshot: '{}' })
      await insert('content_autosave', { content_id: item, account_id: author, snapshot: '{}' })
      await insert('content_revision', { content_id: item, account_id: author, snapshot: '{}' })
      await insert('content_lock', { content_id: item, account_id: author })
      await insert('content_ref', { content_id: item, kind: 'link', target_content_id: linked })
      await insert('content_ref', { content_id: linked, kind: 'link', target_content_id: item })
      await insert('block_note', { content_id: item, block_id: 'b1', body: 'Check this' })
      await insert('comment', { content_id: item, body: 'Hi', status: 'approved' })

      await app.query('delete from content where id = $1', [item])
      const children = [
        'content_author',
        'content_term',
        'content_draft',
        'content_autosave',
        'content_revision',
        'content_lock',
        'content_ref',
        'block_note',
        'comment',
      ]
      for (const table of children) {
        expect(await count(table, 'content_id = $1', [item]), table).toBe(0)
      }
      expect(await count('content_ref', 'target_content_id = $1', [item])).toBe(0)
      expect(await count('term', 'id = $1', [term])).toBe(1)
      expect(await count('account', 'id = $1', [author])).toBe(1)
    })

    it('sets parent_id, featured_media_id, folder_id and release_id to null when the row they point at goes', async () => {
      const parent = await newContent({ type: 'page', slug: 'parent' })
      const child = await newContent({ type: 'page', slug: 'child', parent_id: parent })
      const folder = await insert('media_folder', { name: `f-${parent}` })
      const image = await insert('media', {
        mime: 'image/jpeg',
        size: 10,
        sha256: 'a'.repeat(64),
        storage_key: `k-${parent}`,
        folder_id: folder,
      })
      await app.query('update content set featured_media_id = $1 where id = $2', [image, child])
      const release = await insert('release', { title: 'Autumn' })
      const draft = await insert('content_draft', { content_id: child, release_id: release, snapshot: '{}' })

      await app.query('delete from content where id = $1', [parent])
      await app.query('delete from media_folder where id = $1', [folder])
      await app.query('delete from release where id = $1', [release])
      expect(await count('content', 'id = $1 and parent_id is null', [child])).toBe(1)
      expect(await count('media', 'id = $1 and folder_id is null', [image])).toBe(1)
      expect(await count('content_draft', 'id = $1 and release_id is null', [draft])).toBe(1)

      await app.query('delete from media where id = $1', [image])
      expect(await count('content', 'id = $1 and featured_media_id is null', [child])).toBe(1)
    })
  })

  describe('app role privileges', () => {
    it('can SELECT, INSERT, UPDATE and DELETE on a core table', async () => {
      const id = await insert('menu', { slug: 'main', name: 'Main' })
      await app.query('update menu set name = $1, modified_at = now() where id = $2', ['Primary', id])
      expect((await app.query('select name from menu where id = $1', [id])).rows).toEqual([{ name: 'Primary' }])
      await app.query('delete from menu where id = $1', [id])
      expect((await app.query('select 1 from menu where id = $1', [id])).rowCount).toBe(0)
    })

    it('inserts into content, which takes short_id from the identity, and cannot set short_id itself', async () => {
      const { rows } = await app.query<{ short_id: string }>(
        `insert into content (type, locale, slug, status, comment_status)
         values ('post', 'nb', 'identity-check', 'draft', 'open') returning short_id`,
      )
      expect(Number(rows[0]?.short_id)).toBeGreaterThan(0)
      expect(
        await sqlState(
          app.query(`insert into content (short_id, type, locale, slug, status, comment_status)
                     values (999999, 'post', 'nb', 'identity-forced', 'draft', 'open')`),
        ),
      ).toBe('428C9')
    })

    it('cannot CREATE, ALTER or DROP a table', async () => {
      expect(await sqlState(app.query('create table public.app_made (id int)'))).toBe('42501')
      expect(await sqlState(app.query('alter table content add column app_made int'))).toBe('42501')
      expect(await sqlState(app.query('drop table setting'))).toBe('42501')
      expect(await sqlState(app.query('truncate login_attempt'))).toBe('42501')
    })
  })
})
