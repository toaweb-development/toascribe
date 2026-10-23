// Migration 0005_install_state on a database that v0.3.0 already uses: a site with an administrator counts as installed
// (so the next start does not send it to /setup), one without stays uninstalled. Each case needs its own fresh database,
// so they run one after the other, each creating and dropping one.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CORE_SETTINGS, CoreSettings } from '@toascribe/shared'
import pg from 'pg'
import { pino } from 'pino'
import { beforeAll, describe, expect, it } from 'vitest'

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrator.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'

noticeIfSkipped('install-upgrade')

const logger = pino({ level: 'silent' })

/** The migrations v0.3.0 shipped (0000 to 0004). */
const V0_3_0_MIGRATIONS = 5

/** What v0.3.0's seedCore() did not write; today's seed writes them in the cut run, so the test takes them out again. */
const NEW_SETTINGS = ['admin_email', 'default_category', 'wp_page_for_privacy_policy', 'installed', 'installed_at']

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

interface Upgraded {
  readonly settings: Readonly<Record<string, unknown>>
  readonly audit: readonly pg.QueryResultRow[]
  readonly taxonomies: readonly string[]
}

/** Migrates a fresh database as v0.3.0 left it, lets `prepare` add data, then runs this branch's migrations. */
async function upgrade(prepare: (owner: pg.Client) => Promise<void>): Promise<Upgraded> {
  const database = await createTestDatabase()
  const folder = await migrationsUpTo(V0_3_0_MIGRATIONS)
  const owner = new pg.Client({ connectionString: database.ownerUrl })
  try {
    await runMigrations({ connectionString: database.ownerUrl, logger, migrationsFolder: folder })
    await owner.connect()
    // Back to v0.3.0's seed: no taxonomies and none of the M0.4 settings.
    await owner.query('delete from setting where key = any($1)', [NEW_SETTINGS])
    await owner.query('delete from taxonomy')
    await prepare(owner)

    await runMigrations({ connectionString: database.ownerUrl, logger })

    const settings = await owner.query<{ key: string; value: unknown }>(
      'select key, value from setting where key = any($1)',
      [NEW_SETTINGS],
    )
    const audit = await owner.query(
      `select actor_type, actor, action, object_type, object_id, old_value, new_value, source from audit_log
        where actor = 'migration 0005_install_state' order by object_id`,
    )
    const taxonomies = await owner.query<{ slug: string }>('select slug from taxonomy order by slug')
    return {
      settings: Object.fromEntries(settings.rows.map((r) => [r.key, r.value])),
      audit: audit.rows,
      taxonomies: taxonomies.rows.map((r) => r.slug),
    }
  } finally {
    await owner.end().catch(() => undefined)
    await rm(folder, { recursive: true, force: true })
    await database.drop()
  }
}

async function addAccount(owner: pg.Client, username: string, status: string, roleSlug: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `insert into account (username, email, display_name, nicename, status)
     values ($1, $1 || '@example.test', $1, $1, $2) returning id`,
    [username, status],
  )
  await owner.query('insert into account_role (account_id, role_id) select $1, id from role where slug = $2', [
    rows[0]?.id,
    roleSlug,
  ])
}

describe.skipIf(TEST_DATABASE_URL === undefined)(
  '0005_install_state on a v0.3.0 database (needs TEST_DATABASE_URL)',
  () => {
    let withAdmin: Upgraded
    let withoutAdmin: Upgraded
    let started: number

    beforeAll(async () => {
      started = Date.now()
      withAdmin = await upgrade(async (owner) => {
        await addAccount(owner, 'tor', 'active', 'administrator')
        await addAccount(owner, 'anna', 'active', 'editor')
      })
      // An editor and a disabled administrator do not make a site installed.
      withoutAdmin = await upgrade(async (owner) => {
        await addAccount(owner, 'anna', 'active', 'editor')
        await addAccount(owner, 'old', 'disabled', 'administrator')
      })
    })

    it('marks a site with an active administrator installed, with an ISO time, before the seed runs', () => {
      expect(withAdmin.settings['installed']).toBe(true)
      const at = CoreSettings.shape.installed_at.parse(withAdmin.settings['installed_at'])
      expect(at).not.toBeNull()
      expect(Date.parse(at ?? '')).toBeGreaterThanOrEqual(started - 1000)
      expect(Date.parse(at ?? '')).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('writes the change to audit_log as the system, source setup', () => {
      expect(withAdmin.audit).toEqual([
        {
          actor_type: 'system',
          actor: 'migration 0005_install_state',
          action: 'setting.updated',
          object_type: 'setting',
          object_id: 'installed',
          old_value: null,
          new_value: true,
          source: 'setup',
        },
        {
          actor_type: 'system',
          actor: 'migration 0005_install_state',
          action: 'setting.updated',
          object_type: 'setting',
          object_id: 'installed_at',
          old_value: null,
          new_value: withAdmin.settings['installed_at'],
          source: 'setup',
        },
      ])
    })

    it('leaves a site without an active administrator uninstalled, and writes no audit row', () => {
      expect(withoutAdmin.settings['installed']).toBe(false)
      expect(withoutAdmin.settings['installed_at']).toBeNull()
      expect(withoutAdmin.audit).toEqual([])
    })

    it('gives both the other new settings and the built-in taxonomies from the seed', () => {
      for (const upgraded of [withAdmin, withoutAdmin]) {
        expect(upgraded.settings).toMatchObject({
          admin_email: CORE_SETTINGS.admin_email,
          default_category: null,
          wp_page_for_privacy_policy: null,
        })
        expect(upgraded.taxonomies).toEqual(['category', 'post_tag'])
      }
    })
  },
)
