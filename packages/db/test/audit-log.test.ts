// audit_log against a real PostgreSQL 18 (typescript §6): append-only for the app role, the actor that outlives the
// account, and audit_log_clear_old_ips() (migration 0001_audit_log_privileges; SECURITY_STANDARD §8 «Auditlogg»).
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runMigrations } from '../src/migrator.ts'
import { APP_ROLE, OWNER_ROLE, TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('audit-log')

const logger = pino({ level: 'silent' })

const FUNCTION = 'public.audit_log_clear_old_ips()'

/** Every column of audit_log, to prove the app role can UPDATE none of them. */
const COLUMNS = [
  'id',
  'account_id',
  'actor_type',
  'actor',
  'action',
  'object_type',
  'object_id',
  'old_value',
  'new_value',
  'reason',
  'source',
  'correlation_id',
  'ip',
  'created_at',
]

describe.skipIf(TEST_DATABASE_URL === undefined)('audit_log (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let admin: pg.Client
  let owner: pg.Client
  let app: pg.Client

  /** Inserts as the app role, the way the api will, and returns the new id. */
  async function insert(values: Readonly<Record<string, unknown>>): Promise<string> {
    const row = { actor_type: 'system', actor: 'test', action: 'test.done', source: 'job', ...values }
    const columns = Object.keys(row)
    const params = columns.map((_, i) => `$${String(i + 1)}`)
    const { rows } = await app.query<{ id: string }>(
      `insert into audit_log (${columns.join(', ')}) values (${params.join(', ')}) returning id`,
      Object.values(row),
    )
    const id = rows[0]?.id
    if (id === undefined) {
      throw new Error('insert into audit_log returned no id')
    }
    return id
  }

  /** Inserts as the owner with a chosen age: the app role cannot set created_at in the past by UPDATE. */
  async function insertAged(days: number, ip: string | null): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `insert into audit_log (actor_type, actor, action, source, ip, created_at)
       values ('system', 'test', 'test.aged', 'job', $1, now() - make_interval(days => $2)) returning id`,
      [ip, days],
    )
    const id = rows[0]?.id
    if (id === undefined) {
      throw new Error('insert into audit_log returned no id')
    }
    return id
  }

  async function ipOf(id: string): Promise<string | null> {
    const { rows } = await owner.query<{ ip: string | null }>('select ip::text as ip from audit_log where id = $1', [
      id,
    ])
    return rows[0]?.ip ?? null
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    admin = new pg.Client({ connectionString: database.adminUrl })
    owner = new pg.Client({ connectionString: database.ownerUrl })
    app = new pg.Client({ connectionString: database.appUrl })
    await Promise.all([admin.connect(), owner.connect(), app.connect()])
    await runMigrations({ connectionString: database.ownerUrl, logger })
  })

  afterAll(async () => {
    try {
      await Promise.all([app.end(), owner.end(), admin.end()])
    } finally {
      await database.drop()
    }
  })

  describe('actor', () => {
    it('is required and may not be empty or blank', async () => {
      expect(
        await sqlState(
          app.query(`insert into audit_log (actor_type, action, source) values ('system', 'test.done', 'job')`),
        ),
      ).toBe('23502')
      expect(await sqlState(insert({ actor: null }))).toBe('23502')
      expect(await sqlState(insert({ actor: '' }))).toBe('23514')
      expect(await sqlState(insert({ actor: '  ' }))).toBe('23514')
      expect(await sqlState(insert({ actor: 'backup' }))).toBeUndefined()
    })

    it('survives the deletion of the account: only account_id becomes null', async () => {
      const { rows } = await app.query<{ id: string }>(
        `insert into account (username, email, display_name, nicename, status)
         values ('kari', 'kari@example.test', 'Kari', 'kari', 'active') returning id`,
      )
      const account = rows[0]?.id
      const entry = await insert({ account_id: account, actor_type: 'account', actor: 'kari', source: 'admin' })
      await app.query('delete from account where id = $1', [account])
      const after = await owner.query('select account_id, actor_type, actor from audit_log where id = $1', [entry])
      expect(after.rows).toEqual([{ account_id: null, actor_type: 'account', actor: 'kari' }])
    })
  })

  describe('app role privileges', () => {
    it('has INSERT and SELECT on the table and nothing else', async () => {
      const { rows } = await owner.query<{ privilege: string; granted: boolean }>(
        `select p as privilege, has_table_privilege($1, 'audit_log', p) as granted
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p`,
        [APP_ROLE],
      )
      expect(Object.fromEntries(rows.map((r) => [r.privilege, r.granted]))).toEqual({
        SELECT: true,
        INSERT: true,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
        MAINTAIN: false,
      })
      const columns = await owner.query<{ name: string }>(
        `select attname as name from pg_attribute
          where attrelid = 'audit_log'::regclass and attnum > 0 and not attisdropped
            and has_column_privilege($1, attrelid, attnum, 'UPDATE')`,
        [APP_ROLE],
      )
      expect(columns.rows).toEqual([])
    })

    it('can insert and read back an entry', async () => {
      const entry = await insert({ ip: '192.0.2.1' })
      const { rows } = await app.query('select actor, ip::text as ip from audit_log where id = $1', [entry])
      expect(rows).toEqual([{ actor: 'test', ip: '192.0.2.1/32' }])
    })

    it('cannot UPDATE any column, ip included, and cannot DELETE', async () => {
      const entry = await insert({ ip: '192.0.2.2' })
      for (const column of COLUMNS) {
        expect(
          await sqlState(app.query(`update audit_log set ${column} = ${column} where id = $1`, [entry])),
          column,
        ).toBe('42501')
      }
      expect(await sqlState(app.query('update audit_log set ip = null where id = $1', [entry]))).toBe('42501')
      expect(await sqlState(app.query('delete from audit_log where id = $1', [entry]))).toBe('42501')
      expect(await sqlState(app.query('truncate audit_log'))).toBe('42501')
      expect(await ipOf(entry)).toBe('192.0.2.2/32')
    })
  })

  describe('audit_log_clear_old_ips()', () => {
    it('is owned by the owner role, SECURITY DEFINER, takes no argument and has a fixed search_path', async () => {
      const { rows } = await owner.query(
        `select pg_get_userbyid(proowner) as owner, prosecdef as definer, pronargs as args, proconfig as config,
                provolatile as volatility
           from pg_proc where proname = 'audit_log_clear_old_ips' and pronamespace = 'public'::regnamespace`,
      )
      expect(rows).toEqual([
        { owner: OWNER_ROLE, definer: true, args: 0, config: ['search_path=pg_catalog, pg_temp'], volatility: 'v' },
      ])
    })

    it('may be executed by its owner and the app role only, not by PUBLIC', async () => {
      const { rows } = await owner.query<{ grantee: string; privilege: string }>(
        `select coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type as privilege
           from pg_proc p
           cross join lateral aclexplode(p.proacl) a
           left join pg_roles r on r.oid = a.grantee
          where p.oid = $1::regprocedure
          order by grantee`,
        [FUNCTION],
      )
      expect(rows).toEqual([
        { grantee: APP_ROLE, privilege: 'EXECUTE' },
        { grantee: OWNER_ROLE, privilege: 'EXECUTE' },
      ])
      const publicCan = await owner.query<{ can: boolean }>(
        `select has_function_privilege('public', $1::regprocedure, 'EXECUTE') as can`,
        [FUNCTION],
      )
      expect(publicCan.rows).toEqual([{ can: false }])
    })

    it('cannot be executed by a role without the grant', async () => {
      // A throwaway role inside one superuser transaction that is always rolled back: nothing reaches the cluster.
      await admin.query('begin')
      try {
        await admin.query('create role toascribe_test_no_grant nologin')
        await admin.query('grant usage on schema public to toascribe_test_no_grant')
        await admin.query('set local role toascribe_test_no_grant')
        expect(await sqlState(admin.query(`select ${FUNCTION}`))).toBe('42501')
      } finally {
        await admin.query('rollback')
      }
    })

    it('clears the IP on rows older than 90 days only, and returns how many it cleared', async () => {
      // Rows from earlier tests are newer than 90 days; clear anything old first so the count below is exact.
      await app.query(`select ${FUNCTION}`)
      const old1 = await insertAged(91, '198.51.100.1')
      const old2 = await insertAged(365, '2001:db8::1')
      const oldWithoutIp = await insertAged(200, null)
      const recent = await insertAged(89, '198.51.100.2')
      const fresh = await insert({ ip: '198.51.100.3' })

      const first = await app.query<{ cleared: string }>(`select ${FUNCTION} as cleared`)
      expect(first.rows).toEqual([{ cleared: '2' }])
      expect(await ipOf(old1)).toBeNull()
      expect(await ipOf(old2)).toBeNull()
      expect(await ipOf(oldWithoutIp)).toBeNull()
      expect(await ipOf(recent)).toBe('198.51.100.2/32')
      expect(await ipOf(fresh)).toBe('198.51.100.3/32')

      const second = await app.query<{ cleared: string }>(`select ${FUNCTION} as cleared`)
      expect(second.rows).toEqual([{ cleared: '0' }])
    })

    it('changes nothing but ip', async () => {
      const old = await insertAged(120, '203.0.113.9')
      const before = await owner.query('select * from audit_log where id = $1', [old])
      await app.query(`select ${FUNCTION}`)
      const after = await owner.query('select * from audit_log where id = $1', [old])
      expect(after.rows).toEqual([{ ...before.rows[0], ip: null }])
    })

    it('cannot be called with an argument that would shorten the 90 days', async () => {
      // 42883 undefined_function: there is no overload that takes an interval or a number of days.
      expect(await sqlState(app.query(`select public.audit_log_clear_old_ips(interval '1 day')`))).toBe('42883')
      expect(await sqlState(app.query('select public.audit_log_clear_old_ips(1)'))).toBe('42883')
    })
  })
})
