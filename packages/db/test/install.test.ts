// M0.4 data layer against a real PostgreSQL 18 (typescript §6): the install lock, markInstalled(), the default content
// rows, site_secret and admin_notice, all as the app role (DML only), which is what the api and the CLI use.
import { CORE_SETTINGS, CoreSettings, SETUP_EMAIL_SKIPPED_NOTICE } from '@toascribe/shared'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { parseBlockMarkup } from '../src/default-content/blocks.ts'
import {
  firstCommentText,
  firstPostMarkup,
  privacyPolicyMarkup,
  samplePageMarkup,
} from '../src/default-content/markup.ts'
import { DefaultContentExistsError, seedDefaultContent } from '../src/default-content/seed.ts'
import type { SeedDefaultContentResult } from '../src/default-content/seed.ts'
import { DEFAULT_CONTENT_STRINGS } from '../src/default-content/strings.ts'
import {
  AlreadyInstalledError,
  INSTALL_LOCK_KEY,
  deleteSiteSecret,
  dismissAdminNotice,
  getInstallState,
  getSiteSecret,
  lockInstall,
  markInstalled,
  raiseAdminNotice,
  resolveAdminNotice,
  setSiteSecret,
  writeSetting,
} from '../src/install.ts'
import { runMigrations } from '../src/migrator.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, sqlState } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('install')

const logger = pino({ level: 'silent' })
const SITE = 'https://blogg.example.test'
const HASH_A = 'a'.repeat(64)
const HASH_B = '0123456789abcdef'.repeat(4)

type Client = NodePgDatabase

/** The SQLSTATE of a rejected Drizzle query (Drizzle wraps the pg error as its `cause`), or undefined when it resolved. */
async function drizzleState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof pg.DatabaseError ? err.cause : err
    if (cause instanceof pg.DatabaseError) {
      return cause.code
    }
    throw err
  }
}

describe.skipIf(TEST_DATABASE_URL === undefined)('M0.4 install data (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Pool
  let app: pg.Pool
  let db: Client
  let adminId: string

  async function one<R extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<R> {
    const { rows } = await owner.query<R>(text, [...values])
    const row = rows[0]
    if (row === undefined) {
      throw new Error(`no row: ${text}`)
    }
    return row
  }

  async function counts(): Promise<Record<string, number>> {
    return one(
      `select (select count(*)::int from content) as content, (select count(*)::int from term) as term,
              (select count(*)::int from comment) as comment, (select count(*)::int from content_author) as authors,
              (select count(*)::int from content_term) as links`,
    )
  }

  async function settingValue(key: string): Promise<unknown> {
    return (await one<{ value: unknown }>('select value from setting where key = $1', [key])).value
  }

  /** Back to an uninstalled site with no content, as after `docker compose up` on an empty volume. */
  async function resetSite(): Promise<void> {
    await owner.query('delete from content')
    await owner.query('delete from term')
    await owner.query('delete from site_secret')
    await owner.query('delete from admin_notice')
    await owner.query('alter table content alter column short_id restart with 1')
    for (const key of ['installed', 'installed_at', 'default_category', 'wp_page_for_privacy_policy'] as const) {
      await owner.query('update setting set value = $2::jsonb where key = $1', [
        key,
        JSON.stringify(CORE_SETTINGS[key]),
      ])
    }
  }

  /** One full install as the install service will run it: lock, check, content, flag. */
  function install(client: Client): Promise<SeedDefaultContentResult> {
    return client.transaction(async (tx) => {
      const state = await lockInstall(tx)
      if (state.installed) {
        throw new AlreadyInstalledError()
      }
      const result = await seedDefaultContent(tx, { siteUrl: SITE, adminAccountId: adminId, locale: 'nb' })
      await markInstalled(tx)
      return result
    })
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    app = new pg.Pool({ connectionString: database.appUrl, max: 6 })
    db = drizzle({ client: app })
    await runMigrations({ connectionString: database.ownerUrl, logger })
    const { rows } = await app.query<{ id: string }>(
      `insert into account (username, email, display_name, nicename, status)
       values ('admin', 'admin@example.test', 'admin', 'admin', 'active') returning id`,
    )
    adminId = rows[0]?.id ?? ''
    await app.query(
      `insert into account_role (account_id, role_id) select $1, id from role where slug = 'administrator'`,
      [adminId],
    )
  })

  afterAll(async () => {
    try {
      await app.end()
      await owner.end()
    } finally {
      await database.drop()
    }
  })

  describe('migration 0005 and the seed', () => {
    it('seeds the install settings uninstalled, and both built-in taxonomies', async () => {
      expect(await getInstallState(db)).toEqual({ installed: false, installedAt: null })
      for (const key of [
        'installed',
        'installed_at',
        'admin_email',
        'default_category',
        'wp_page_for_privacy_policy',
      ]) {
        expect(await settingValue(key), key).toEqual(CORE_SETTINGS[key as keyof typeof CORE_SETTINGS])
      }
      const { rows } = await owner.query(
        'select slug, name, is_hierarchical, content_types from taxonomy order by slug',
      )
      expect(rows).toEqual([
        { slug: 'category', name: 'Categories', is_hierarchical: true, content_types: ['post'] },
        { slug: 'post_tag', name: 'Tags', is_hierarchical: false, content_types: ['post'] },
      ])
    })

    it('counts a missing installed row as not installed', async () => {
      await owner.query(`delete from setting where key in ('installed', 'installed_at')`)
      try {
        expect(await getInstallState(db)).toEqual({ installed: false, installedAt: null })
      } finally {
        await owner.query(
          `insert into setting (key, value) values ('installed', 'false'::jsonb), ('installed_at', 'null'::jsonb)`,
        )
      }
    })
  })

  describe('the install lock', () => {
    beforeEach(resetSite)

    it('makes a second install wait until the first commits, and then see installed', async () => {
      const first = new pg.Client({ connectionString: database.appUrl })
      await first.connect()
      try {
        await first.query('begin')
        await first.query('select pg_advisory_xact_lock($1::bigint)', [INSTALL_LOCK_KEY])

        let seen: boolean | undefined
        const second = db
          .transaction(async (tx) => (await lockInstall(tx)).installed)
          .then((installed) => {
            seen = installed
          })
        await new Promise((resolve) => setTimeout(resolve, 400))
        expect(seen).toBeUndefined()
        const waiting = await one<{ n: number }>(
          `select count(*)::int as n from pg_locks
            where locktype = 'advisory' and not granted and ((classid::bigint << 32) | objid::bigint) = $1`,
          [INSTALL_LOCK_KEY],
        )
        expect(waiting.n).toBe(1)

        await first.query(`update setting set value = 'true'::jsonb where key = 'installed'`)
        await first.query('commit')
        await second
        expect(seen).toBe(true)
      } finally {
        await first.end()
      }
    })

    it('lets exactly one of two concurrent installs win, and leaves one set of default content', async () => {
      const results = await Promise.allSettled([install(db), install(db)])
      const won = results.filter((r) => r.status === 'fulfilled')
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect(lost[0]?.reason).toBeInstanceOf(AlreadyInstalledError)
      expect(await counts()).toEqual({ content: 3, term: 1, comment: 1, authors: 3, links: 1 })
      expect((await getInstallState(db)).installed).toBe(true)
    })

    it('rolls the whole install back when a step after the content fails', async () => {
      await expect(
        db.transaction(async (tx) => {
          await lockInstall(tx)
          await seedDefaultContent(tx, { siteUrl: SITE, adminAccountId: adminId, locale: 'nb' })
          await markInstalled(tx)
          throw new Error('the administrator could not be made')
        }),
      ).rejects.toThrow('the administrator could not be made')
      expect(await counts()).toEqual({ content: 0, term: 0, comment: 0, authors: 0, links: 0 })
      expect(await getInstallState(db)).toEqual({ installed: false, installedAt: null })
      expect(await settingValue('default_category')).toBeNull()
    })

    it('releases the lock at commit and at rollback', async () => {
      await db.transaction(async (tx) => {
        await lockInstall(tx)
      })
      await db
        .transaction(async (tx) => {
          await lockInstall(tx)
          throw new Error('rollback')
        })
        .catch(() => undefined)
      const held = await one<{ n: number }>(
        `select count(*)::int as n from pg_locks
          where locktype = 'advisory' and ((classid::bigint << 32) | objid::bigint) = $1`,
        [INSTALL_LOCK_KEY],
      )
      expect(held.n).toBe(0)
    })
  })

  describe('markInstalled', () => {
    beforeEach(resetSite)

    it('writes settings through their schema only (writeSetting)', async () => {
      await writeSetting(db, 'admin_email', 'admin@example.test')
      expect(await settingValue('admin_email')).toBe('admin@example.test')
      await expect(writeSetting(db, 'admin_email', 'not an address')).rejects.toThrow()
      await expect(writeSetting(db, 'installed_at', '23.10.2026')).rejects.toThrow()
      expect(await settingValue('admin_email')).toBe('admin@example.test')
      await writeSetting(db, 'admin_email', null)
      expect(await settingValue('admin_email')).toBeNull()
    })

    it('sets the flag and an ISO time, deletes the setup token and keeps the recovery key verifier', async () => {
      await setSiteSecret(db, 'setup_token', HASH_A)
      await setSiteSecret(db, 'backup_recovery_key', HASH_B)
      const at = new Date('2026-10-23T06:00:00.000Z')
      expect(await db.transaction((tx) => markInstalled(tx, at))).toBe('2026-10-23T06:00:00.000Z')

      expect(await getInstallState(db)).toEqual({ installed: true, installedAt: '2026-10-23T06:00:00.000Z' })
      expect(CoreSettings.shape.installed_at.parse(await settingValue('installed_at'))).toBe('2026-10-23T06:00:00.000Z')
      expect(await getSiteSecret(db, 'setup_token')).toBeUndefined()
      expect((await getSiteSecret(db, 'backup_recovery_key'))?.secretHash).toBe(HASH_B)
    })

    it('refuses a second install, even without the lock, and changes nothing', async () => {
      await db.transaction((tx) => markInstalled(tx, new Date('2026-10-23T06:00:00.000Z')))
      await setSiteSecret(db, 'setup_token', HASH_A)
      await expect(db.transaction((tx) => markInstalled(tx))).rejects.toBeInstanceOf(AlreadyInstalledError)
      expect(await getInstallState(db)).toEqual({ installed: true, installedAt: '2026-10-23T06:00:00.000Z' })
      expect(await getSiteSecret(db, 'setup_token')).toBeDefined()
    })
  })

  describe('seedDefaultContent', () => {
    let result: SeedDefaultContentResult
    const nb = DEFAULT_CONTENT_STRINGS.nb

    beforeAll(async () => {
      await resetSite()
      result = await db.transaction((tx) =>
        seedDefaultContent(tx, { siteUrl: `${SITE}/`, adminAccountId: adminId, locale: 'nb' }),
      )
    })

    it('writes «Ukategorisert» in category and sets it as default_category', async () => {
      const { rows } = await owner.query(
        `select t.name, t.slug, t.description, t.parent_id, x.slug as taxonomy from term t
           join taxonomy x on x.id = t.taxonomy_id`,
      )
      expect(rows).toEqual([
        { name: 'Ukategorisert', slug: 'ukategorisert', description: '', parent_id: null, taxonomy: 'category' },
      ])
      expect(await settingValue('default_category')).toBe(result.categoryId)
    })

    it('writes the post and the two pages with WordPress’ titles, slugs, statuses and order', async () => {
      const { rows } = await owner.query(
        `select short_id, type, locale, slug, title, excerpt, status, comment_status, sticky, menu_order, template,
                parent_id, published_at is not null as is_published_at_set
           from content order by short_id`,
      )
      const base = { locale: 'nb', excerpt: '', sticky: false, menu_order: 0, template: null, parent_id: null }
      expect(rows).toEqual([
        {
          ...base,
          short_id: '1',
          type: 'post',
          slug: 'hei-verden',
          title: 'Hei, verden!',
          status: 'publish',
          comment_status: 'open',
          is_published_at_set: true,
        },
        {
          ...base,
          short_id: '2',
          type: 'page',
          slug: 'testside',
          title: 'Testside',
          status: 'publish',
          comment_status: 'closed',
          is_published_at_set: true,
        },
        {
          ...base,
          short_id: '3',
          type: 'page',
          slug: 'personvernerklæring',
          title: 'Personvernerklæring',
          status: 'draft',
          comment_status: 'closed',
          is_published_at_set: false,
        },
      ])
    })

    it('makes the administrator the author of all three and puts the post in «Ukategorisert»', async () => {
      const authors = await owner.query('select content_id, account_id, sort from content_author order by content_id')
      expect(authors.rows).toEqual(
        [result.postId, result.samplePageId, result.privacyPolicyPageId]
          .sort()
          .map((id) => ({ content_id: id, account_id: adminId, sort: 0 })),
      )
      const links = await owner.query('select content_id, term_id from content_term')
      expect(links.rows).toEqual([{ content_id: result.postId, term_id: result.categoryId }])
    })

    it('writes one approved comment by «En WordPress-kommentator» on the post', async () => {
      const { rows } = await owner.query<{ body: string }>(
        `select id, content_id, parent_id, account_id, author, author_email, author_url, ip, user_agent, type, body, status
           from comment`,
      )
      expect(rows).toEqual([
        {
          id: result.commentId,
          content_id: result.postId,
          parent_id: null,
          account_id: null,
          author: 'En WordPress-kommentator',
          author_email: 'wapuu@wordpress.example',
          author_url: 'https://nb.wordpress.org/',
          ip: null,
          user_agent: '',
          type: 'comment',
          body: firstCommentText(nb),
          status: 'approved',
        },
      ])
      expect(rows[0]?.body).toContain('<a href="https://nb.gravatar.com/">Gravatar</a>')
    })

    it('stores the blocks parsed from WordPress’ markup, with the site URL filled in and the entities fixed', async () => {
      const blocks = async (id: string): Promise<unknown> =>
        (await one<{ blocks: unknown }>('select blocks from content where id = $1', [id])).blocks
      expect(await blocks(result.postId)).toEqual(parseBlockMarkup(firstPostMarkup(nb)))
      expect(await blocks(result.samplePageId)).toEqual(parseBlockMarkup(samplePageMarkup(nb, `${SITE}/admin/`)))
      expect(await blocks(result.privacyPolicyPageId)).toEqual(parseBlockMarkup(privacyPolicyMarkup(nb, SITE)))

      const all = JSON.stringify((await owner.query<{ blocks: unknown }>('select blocks from content')).rows)
      expect(all).not.toContain('{SITEURL}')
      expect(all).not.toContain('%s')
      expect(all).not.toMatch(/&lauot;|&raquot;/)
      expect(all).toContain('«Husk meg»')
      expect(all).toContain(`Vår nettstedsadresse er: ${SITE}<`)
      expect(all).toContain(`<a href=\\"${SITE}/admin/\\">ditt kontrollpanel</a>`)
    })

    it('sets wp_page_for_privacy_policy to the draft privacy page', async () => {
      expect(await settingValue('wp_page_for_privacy_policy')).toBe(result.privacyPolicyPageId)
    })

    it('fills the search vector with the Norwegian configuration', async () => {
      const { rows } = await owner.query<{ slug: string }>(
        `select slug from content where search @@ to_tsquery('norwegian', 'kommentarer') order by short_id`,
      )
      expect(rows.map((r) => r.slug)).toEqual(['testside', 'personvernerklæring'])
      const post = await one<{ hit: boolean }>(
        `select search @@ to_tsquery('norwegian', 'verden') as hit from content where id = $1`,
        [result.postId],
      )
      expect(post.hit).toBe(true)
    })

    it('throws on a second call and writes nothing', async () => {
      const before = await counts()
      const error: unknown = await seedDefaultContent(db, {
        siteUrl: SITE,
        adminAccountId: adminId,
        locale: 'nb',
      }).catch((err: unknown) => err)
      expect(error).toBeInstanceOf(DefaultContentExistsError)
      expect((error as DefaultContentExistsError).existing).toEqual([
        'category ukategorisert',
        'page personvernerklæring',
        'page testside',
        'post hei-verden',
      ])
      expect(await counts()).toEqual(before)
    })
  })

  describe('seedDefaultContent failing half-way', () => {
    beforeEach(resetSite)

    it('leaves nothing behind when the author does not exist (its own savepoint)', async () => {
      const missing = '0199f3a0-0000-7000-8000-000000000000'
      expect(await drizzleState(seedDefaultContent(db, { siteUrl: SITE, adminAccountId: missing, locale: 'nb' }))).toBe(
        '23503',
      )
      expect(await counts()).toEqual({ content: 0, term: 0, comment: 0, authors: 0, links: 0 })
    })

    it('refuses a site URL that is not an origin, before writing', async () => {
      for (const siteUrl of ['blogg.example.test', 'https://blogg.example.test/blogg', 'ftp://blogg.example.test']) {
        await expect(
          seedDefaultContent(db, { siteUrl, adminAccountId: adminId, locale: 'nb' }),
          siteUrl,
        ).rejects.toThrow(/origin/)
      }
      expect(await counts()).toEqual({ content: 0, term: 0, comment: 0, authors: 0, links: 0 })
    })

    it('writes the English content for another locale, under that locale', async () => {
      await db.transaction((tx) => seedDefaultContent(tx, { siteUrl: SITE, adminAccountId: adminId, locale: 'en-GB' }))
      const { rows } = await owner.query('select locale, slug, title from content order by short_id')
      expect(rows).toEqual([
        { locale: 'en-GB', slug: 'hello-world', title: 'Hello world!' },
        { locale: 'en-GB', slug: 'sample-page', title: 'Sample Page' },
        { locale: 'en-GB', slug: 'privacy-policy', title: 'Privacy Policy' },
      ])
      expect(await one('select name, slug from term')).toEqual({ name: 'Uncategorized', slug: 'uncategorized' })
    })
  })

  describe('site_secret', () => {
    beforeEach(resetSite)

    it('stores one hash per purpose, replaces it with a new created_at, and deletes it', async () => {
      await setSiteSecret(db, 'setup_token', HASH_A)
      const first = await getSiteSecret(db, 'setup_token')
      await new Promise((resolve) => setTimeout(resolve, 20))
      await setSiteSecret(db, 'setup_token', HASH_B)
      const second = await getSiteSecret(db, 'setup_token')
      expect(second?.secretHash).toBe(HASH_B)
      expect(second?.createdAt.getTime()).toBeGreaterThan(first?.createdAt.getTime() ?? Number.POSITIVE_INFINITY)
      expect(await one('select count(*)::int as n from site_secret')).toEqual({ n: 1 })
      expect(await deleteSiteSecret(db, 'setup_token')).toBe(true)
      expect(await deleteSiteSecret(db, 'setup_token')).toBe(false)
      expect(await getSiteSecret(db, 'setup_token')).toBeUndefined()
    })

    it('refuses anything but 64 lower-case hex characters, so a raw token cannot be stored', async () => {
      for (const hash of ['k3J9_raw-base64url-token-of-43-characters-xx', 'A'.repeat(64), 'a'.repeat(63), '']) {
        expect(await drizzleState(setSiteSecret(db, 'setup_token', hash)), hash).toBe('23514')
      }
      expect(
        await sqlState(app.query(`insert into site_secret (purpose, secret_hash) values ('api_key', $1)`, [HASH_A])),
      ).toBe('23514')
    })

    it('is not a setting: no setting row holds a hash', async () => {
      await setSiteSecret(db, 'backup_recovery_key', HASH_B)
      const { rows } = await owner.query(`select key from setting where value::text like '%' || $1 || '%'`, [HASH_B])
      expect(rows).toEqual([])
    })
  })

  describe('admin_notice', () => {
    beforeEach(resetSite)

    async function notices(): Promise<pg.QueryResultRow[]> {
      const { rows } = await owner.query<pg.QueryResultRow>(
        `select key, level, message_key, data, capability, is_dismissible, dismissed_at is not null as is_dismissed
           from admin_notice order by key`,
      )
      return rows
    }

    it('stores the skipped e-mail notice for the dashboard, once per key', async () => {
      await raiseAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE)
      await raiseAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE)
      expect(await notices()).toEqual([
        {
          key: 'setup.email_skipped',
          level: 'warning',
          message_key: 'notices.setupEmailSkipped',
          data: {},
          capability: 'manage_options',
          is_dismissible: true,
          is_dismissed: false,
        },
      ])
    })

    it('shows a dismissed notice again when it is raised again, with the new data', async () => {
      await raiseAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE)
      expect(await dismissAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE.key)).toBe(true)
      expect(await dismissAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE.key)).toBe(false)
      expect((await notices())[0]).toMatchObject({ is_dismissed: true })
      await raiseAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE, { attempts: 2 })
      expect((await notices())[0]).toMatchObject({ is_dismissed: false, data: { attempts: 2 } })
    })

    it('cannot dismiss a notice that is not dismissible, and deletes a resolved one', async () => {
      await raiseAdminNotice(db, { ...SETUP_EMAIL_SKIPPED_NOTICE, key: 'core.sticky', isDismissible: false })
      expect(await dismissAdminNotice(db, 'core.sticky')).toBe(false)
      expect(await resolveAdminNotice(db, 'core.sticky')).toBe(true)
      expect(await resolveAdminNotice(db, 'core.sticky')).toBe(false)
      expect(await notices()).toEqual([])
    })

    it('refuses an unknown level, a key with capitals or spaces, and an empty message key', async () => {
      const insert = (key: string, level: string, messageKey: string): Promise<unknown> =>
        app.query('insert into admin_notice (key, level, message_key) values ($1, $2, $3)', [key, level, messageKey])
      expect(await sqlState(insert('a.b', 'critical', 'notices.x'))).toBe('23514')
      expect(await sqlState(insert('Setup Email', 'info', 'notices.x'))).toBe('23514')
      expect(await sqlState(insert('a.b', 'info', ''))).toBe('23514')
      expect(await sqlState(insert('a.b', 'info', 'notices.x'))).toBeUndefined()
    })
  })
})
