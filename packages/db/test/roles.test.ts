// docker/postgres/init.sql: both roles, least privilege for the app role (POSTGRESQL_STANDARD_2026,
// «Roller og tilganger»).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  APP_ROLE,
  OWNER_ROLE,
  TEST_DATABASE_URL,
  createTestDatabase,
  noticeIfSkipped,
  queryAs,
  sqlState,
} from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('roles')

describe.skipIf(TEST_DATABASE_URL === undefined)('init.sql roles (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.drop()
  })

  it('creates both roles as plain logins: no superuser, no BYPASSRLS, no CREATEDB or CREATEROLE', async () => {
    const rows = await queryAs<{ rolname: string; flags: string }>(
      database.adminUrl,
      `select rolname, concat_ws(',', rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole) as flags
         from pg_roles where rolname = any($1) order by rolname`,
      [[OWNER_ROLE, APP_ROLE]],
    )
    expect(rows).toEqual([
      { rolname: APP_ROLE, flags: 't,f,f,f,f' },
      { rolname: OWNER_ROLE, flags: 't,f,f,f,f' },
    ])
  })

  it('lets both roles log in with their passwords (scram-sha-256)', async () => {
    expect(await queryAs(database.ownerUrl, 'select current_user as me')).toEqual([{ me: OWNER_ROLE }])
    expect(await queryAs(database.appUrl, 'select current_user as me')).toEqual([{ me: APP_ROLE }])
  })

  it('makes the owner role own the database, schema public and schema pgboss', async () => {
    const rows = await queryAs<{ object: string; owner: string }>(
      database.adminUrl,
      `select 'database' as object, pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()
       union all
       select nspname, pg_get_userbyid(nspowner) from pg_namespace where nspname in ('public', 'pgboss')
       order by object`,
    )
    expect(rows).toEqual([
      { object: 'database', owner: OWNER_ROLE },
      { object: 'pgboss', owner: OWNER_ROLE },
      { object: 'public', owner: 'pg_database_owner' },
    ])
  })

  it('does not let the app role CREATE TABLE in public', async () => {
    expect(await sqlState(queryAs(database.appUrl, 'create table public.app_made (id int)'))).toBe('42501')
  })

  it('does not let the app role CREATE TABLE in pgboss', async () => {
    expect(await sqlState(queryAs(database.appUrl, 'create table pgboss.app_made (id int)'))).toBe('42501')
  })

  it('does not let the app role CREATE SCHEMA', async () => {
    expect(await sqlState(queryAs(database.appUrl, 'create schema app_made'))).toBe('42501')
  })

  it('gives the app role DML on tables the owner creates later, and nothing more', async () => {
    await queryAs(database.ownerUrl, 'create table public.probe (id bigint generated always as identity primary key)')
    const rows = await queryAs<{ privilege: string; granted: boolean }>(
      database.adminUrl,
      `select p as privilege, has_table_privilege($1, 'public.probe', p) as granted
         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as p`,
      [APP_ROLE],
    )
    expect(Object.fromEntries(rows.map((r) => [r.privilege, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: true,
      DELETE: true,
      TRUNCATE: false,
      REFERENCES: false,
      TRIGGER: false,
      MAINTAIN: false,
    })
    expect(await queryAs(database.appUrl, 'insert into public.probe default values returning id')).toEqual([
      { id: '1' },
    ])
    expect(await sqlState(queryAs(database.appUrl, 'drop table public.probe'))).toBe('42501')
    await queryAs(database.ownerUrl, 'drop table public.probe')
  })
})
