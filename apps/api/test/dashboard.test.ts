// The dashboard (M0.5): «I korte trekk» and the notices, with the default content that the install writes.
import { createDb, seedDefaultContent } from '@toascribe/db'
import {
  ApiError,
  EMAIL_NOT_VERIFIED_NOTICE,
  GlanceResponse,
  NoticeListResponse,
  PROXY_NOT_TRUSTED_NOTICE,
  SETUP_EMAIL_SKIPPED_NOTICE,
} from '@toascribe/shared'
import type { Notice } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createNoticeService } from '../src/services/notices.ts'
import type { ProxyCheck, ProxyStatus } from '../src/services/proxy-check.ts'
import { createAuditor } from '../src/services/support.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'
import { TEST_ORIGIN, memoryLogger } from './helpers.ts'

noticeIfSkipped('dashboard')

const keys = (notices: readonly Notice[]) => notices.map((notice) => notice.key)

describe.skipIf(TEST_DATABASE_URL === undefined)('dashboard (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let editor: TestClient
  let subscriber: TestClient
  let adminAccountId: string

  beforeAll(async () => {
    env = await startAuthApp()
    const make = async (username: string, role: 'administrator' | 'editor' | 'subscriber') => {
      const account = await env.createAccount({ username, role })
      const client = env.client({ ip: '203.0.113.20' })
      expect((await client.login(username, TEST_PASSWORD)).status).toBe(200)
      return { account, client }
    }
    const a = await make('dash-admin', 'administrator')
    admin = a.client
    adminAccountId = a.account.id
    editor = (await make('dash-editor', 'editor')).client
    subscriber = (await make('dash-subscriber', 'subscriber')).client

    const { db, pool } = createDb({ connectionString: env.database.appUrl, max: 2 })
    try {
      await seedDefaultContent(db, { siteUrl: TEST_ORIGIN, adminAccountId, locale: 'nb' })
    } finally {
      await pool.end()
    }
  })
  afterAll(async () => {
    await env.close()
  })

  const notices = async (client: TestClient) => {
    const res = await client.get('/api/v1/notices')
    expect(res.status).toBe(200)
    return NoticeListResponse.parse(await res.json()).notices
  }
  const raise = (key: string, extra: { capability?: string; dismissible?: boolean; level?: string } = {}) =>
    env.query(
      `insert into admin_notice (key, level, message_key, capability, is_dismissible, data)
       values ($1, $2, 'notices.test', $3, $4, '{"count": 3}'::jsonb)
       on conflict (key) do update set dismissed_at = null`,
      [key, extra.level ?? 'info', extra.capability ?? 'manage_options', extra.dismissible ?? true],
    )
  const setVerified = (value: string | null) =>
    env.query(
      `insert into setting (key, value) values ('smtp_verified_at', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(value)],
    )

  describe('GET /api/v1/dashboard/glance', () => {
    it('gives an administrator every count, on the default content from the install', async () => {
      const res = await admin.get('/api/v1/dashboard/glance')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = GlanceResponse.parse(await res.json())
      // «Hei, verden!» is published, the sample page is published, the privacy page is a draft; the first comment is approved.
      expect(body).toEqual({ posts: 1, pages: 1, comments: { approved: 1, pending: 0 }, version: '9.9.9' })
    })

    it('gives a subscriber the version and nothing else: the counts are left out, not 0', async () => {
      const res = await subscriber.get('/api/v1/dashboard/glance')
      expect(await res.json()).toEqual({ version: '9.9.9' })
    })

    it("follows WordPress' capabilities: an editor can edit posts, pages and moderate comments", async () => {
      const body = GlanceResponse.parse(await (await editor.get('/api/v1/dashboard/glance')).json())
      expect(body.posts).toBe(1)
      expect(body.pages).toBe(1)
      expect(body.comments).toEqual({ approved: 1, pending: 0 })
    })

    it('counts only published items and the two comment states', async () => {
      await env.query(
        `insert into content (type, locale, slug, title, status, status_before_trash, comment_status)
         values ('post', 'nb', 'draft-one', 'x', 'draft', null, 'open'), ('post', 'nb', 'trashed', 'x', 'trash', 'publish', 'open'),
                ('post', 'nb', 'second', 'x', 'publish', null, 'open'), ('custom', 'nb', 'other-type', 'x', 'publish', null, 'open')`,
      )
      await env.query(
        `insert into comment (content_id, body, status)
         select id, 'c', s from content, unnest(array['pending', 'pending', 'spam', 'trash']) s where slug = 'second'`,
      )
      const body = GlanceResponse.parse(await (await admin.get('/api/v1/dashboard/glance')).json())
      expect(body).toMatchObject({ posts: 2, pages: 1, comments: { approved: 1, pending: 2 } })
    })

    it('answers 401 without a session', async () => {
      expect((await env.client().get('/api/v1/dashboard/glance')).status).toBe(401)
    })
  })

  describe('GET /api/v1/notices', () => {
    it('shows an administrator the e-mail warning once, and the skip row not at all while that shows', async () => {
      await raise(SETUP_EMAIL_SKIPPED_NOTICE.key, { level: 'warning' })
      const list = await notices(admin)
      expect(keys(list)).toEqual([EMAIL_NOT_VERIFIED_NOTICE.key])
      expect(list[0]).toEqual({
        key: 'email.not_verified',
        level: 'warning',
        messageKey: 'notices.emailNotVerified',
        data: {},
        isDismissible: false,
      })
    })

    it('shows the e-mail warning once without the skip row too', async () => {
      await env.query('delete from admin_notice where key = $1', [SETUP_EMAIL_SKIPPED_NOTICE.key])
      expect(keys(await notices(admin))).toEqual([EMAIL_NOT_VERIFIED_NOTICE.key])
    })

    it('drops the e-mail warning once smtp_verified_at is set, and brings it back when it is cleared', async () => {
      await setVerified('2027-01-10T12:00:00.000Z')
      expect(keys(await notices(admin))).toEqual([])
      await setVerified(null)
      expect(keys(await notices(admin))).toEqual([EMAIL_NOT_VERIFIED_NOTICE.key])
    })

    it('shows only what the capability allows', async () => {
      await raise('test.admin_only', { capability: 'manage_options' })
      await raise('test.for_editors', { capability: 'edit_posts' })
      await raise('test.for_everyone', { capability: 'read' })
      expect(keys(await notices(admin)).sort()).toEqual(
        ['email.not_verified', 'test.admin_only', 'test.for_editors', 'test.for_everyone'].sort(),
      )
      expect(keys(await notices(editor)).sort()).toEqual(['test.for_editors', 'test.for_everyone'])
      expect(keys(await notices(subscriber))).toEqual(['test.for_everyone'])
      await env.query(`delete from admin_notice where key like 'test.%'`)
    })

    it('gives the fields of the row, the most severe first', async () => {
      await raise('test.info', { level: 'info' })
      await raise('test.error', { level: 'error' })
      // Nested values have no use in a message and are not passed on (the OpenAPI document cannot describe them).
      await env.query(
        `update admin_notice set data = '{"count": 3, "nested": {"a": 1}}'::jsonb where key = 'test.error'`,
      )
      const list = await notices(admin)
      expect(keys(list)).toEqual(['test.error', 'email.not_verified', 'test.info'])
      expect(list[0]).toEqual({
        key: 'test.error',
        level: 'error',
        messageKey: 'notices.test',
        data: { count: 3 },
        isDismissible: true,
      })
      await env.query(`delete from admin_notice where key like 'test.%'`)
    })

    it('answers 401 without a session', async () => {
      expect((await env.client().get('/api/v1/notices')).status).toBe(401)
    })
  })

  describe('POST /api/v1/notices/{key}/dismiss', () => {
    const dismiss = (client: TestClient, key: string, options?: Parameters<TestClient['post']>[2]) =>
      client.post(`/api/v1/notices/${key}/dismiss`, undefined, options)

    it('dismisses for everyone, audit-logs it, and the notice is gone from every list', async () => {
      await raise('test.dismiss_me', { capability: 'edit_posts' })
      expect(keys(await notices(editor))).toContain('test.dismiss_me')
      const res = await dismiss(editor, 'test.dismiss_me')
      expect(res.status).toBe(204)
      expect(keys(await notices(editor))).not.toContain('test.dismiss_me')
      expect(keys(await notices(admin))).not.toContain('test.dismiss_me')
      const rows = await env.query<{ dismissed_at: Date | null }>(
        `select dismissed_at from admin_notice where key = 'test.dismiss_me'`,
      )
      expect(rows[0]?.dismissed_at).toBeInstanceOf(Date)
      const audit = await env.query<{ actor: string; action: string; object_type: string; object_id: string }>(
        `select actor, action, object_type, object_id from audit_log where action = 'notice.dismissed'`,
      )
      expect(audit).toEqual([
        { actor: 'dash-editor', action: 'notice.dismissed', object_type: 'admin_notice', object_id: 'test.dismiss_me' },
      ])
    })

    it('answers 404 to someone who may not see the notice, as for one that does not exist, and changes nothing', async () => {
      await raise('test.admins_only', { capability: 'manage_options' })
      const refused = await dismiss(subscriber, 'test.admins_only')
      const missing = await dismiss(subscriber, 'test.nothing_here')
      expect(refused.status).toBe(404)
      expect(missing.status).toBe(404)
      expect(ApiError.parse(await refused.json()).error.message).toBe(
        ApiError.parse(await missing.json()).error.message,
      )
      expect((await dismiss(editor, 'test.admins_only')).status).toBe(404)
      const rows = await env.query<{ dismissed_at: Date | null }>(
        `select dismissed_at from admin_notice where key = 'test.admins_only'`,
      )
      expect(rows[0]?.dismissed_at).toBeNull()
      expect(keys(await notices(admin))).toContain('test.admins_only')
    })

    it('answers 404 for a notice that cannot be dismissed, and for the ones the api works out', async () => {
      await raise('test.fixed', { dismissible: false })
      expect((await dismiss(admin, 'test.fixed')).status).toBe(404)
      expect((await dismiss(admin, EMAIL_NOT_VERIFIED_NOTICE.key)).status).toBe(404)
      expect((await dismiss(admin, PROXY_NOT_TRUSTED_NOTICE.key)).status).toBe(404)
      expect(keys(await notices(admin))).toContain('test.fixed')
    })

    it('answers 404 for a second dismissal, and shows the notice again when it is raised again', async () => {
      await raise('test.twice')
      expect((await dismiss(admin, 'test.twice')).status).toBe(204)
      expect((await dismiss(admin, 'test.twice')).status).toBe(404)
      await raise('test.twice')
      expect(keys(await notices(admin))).toContain('test.twice')
    })

    it('answers 400 for a key that is not a notice key, 403 without the CSRF token, 401 without a session', async () => {
      await raise('test.csrf')
      expect((await dismiss(admin, 'Not%20A%20Key')).status).toBe(400)
      expect((await dismiss(admin, 'test.csrf', { csrf: 'none' })).status).toBe(403)
      expect((await dismiss(admin, 'test.csrf', { csrf: 'wrong' })).status).toBe(403)
      expect((await dismiss(admin, 'test.csrf', { origin: 'https://evil.example' })).status).toBe(400)
      expect((await dismiss(env.client(), 'test.csrf', { csrf: 'none' })).status).toBe(401)
      const rows = await env.query<{ dismissed_at: Date | null }>(
        `select dismissed_at from admin_notice where key = 'test.csrf'`,
      )
      expect(rows[0]?.dismissed_at).toBeNull()
    })
  })

  describe('the proxy warning', () => {
    /** The notice service over this database with a proxy check whose state the test sets. */
    async function withProxy(status: ProxyStatus) {
      const { db, pool } = createDb({ connectionString: env.database.appUrl, max: 2 })
      const proxy: ProxyCheck = { observe: () => undefined, status: () => status }
      const service = createNoticeService({ db, clock: env.clock.now, proxy, audit: createAuditor(env.clock.now) })
      const session = await env.services.sessions.authenticate(admin.sessionToken ?? '', memoryLogger().logger)
      const subscriberSession = await env.services.sessions.authenticate(
        subscriber.sessionToken ?? '',
        memoryLogger().logger,
      )
      if (session.kind !== 'session' || subscriberSession.kind !== 'session') {
        throw new Error('the test accounts should be signed in')
      }
      return {
        service,
        auth: session,
        subscriberAuth: subscriberSession,
        close: () => pool.end(),
      }
    }

    it('shows administrators a warning with the observed address while the state is warning, and not otherwise', async () => {
      await env.query(`delete from admin_notice where key like 'test.%'`)
      const warning = await withProxy({ state: 'warning', observed: 50, address: '10.231.97.5' })
      const ok = await withProxy({ state: 'ok', observed: 50, address: null })
      const watching = await withProxy({ state: 'watching', observed: 3, address: null })
      const configured = await withProxy({ state: 'configured', observed: 0, address: null })
      try {
        const shown = (await warning.service.list(warning.auth)).filter((n) => n.key === PROXY_NOT_TRUSTED_NOTICE.key)
        expect(shown).toEqual([
          {
            key: 'proxy.not_trusted',
            level: 'warning',
            messageKey: 'notices.proxyNotTrusted',
            data: { address: '10.231.97.5' },
            isDismissible: false,
          },
        ])
        for (const other of [ok, watching, configured]) {
          expect(keys(await other.service.list(other.auth))).not.toContain(PROXY_NOT_TRUSTED_NOTICE.key)
        }
        // Those without manage_options never see it.
        expect(keys(await warning.service.list(warning.subscriberAuth))).toEqual([])
      } finally {
        await Promise.all([warning.close(), ok.close(), watching.close(), configured.close()])
      }
    })

    it('reaches the dashboard through the route once every request has come from one private address', async () => {
      // An app of its own over the same database, so the first requests it sees are the ones this test sends.
      const lone = env.variant({})
      const account = await env.createAccount({ username: 'lone-admin', role: 'administrator' })
      const client = lone.client({ ip: '10.231.97.5' })
      await client.login(account.username, TEST_PASSWORD)
      const read = async () => NoticeListResponse.parse(await (await client.get('/api/v1/notices')).json()).notices
      expect(keys(await read())).not.toContain('proxy.not_trusted')
      for (let i = 0; i < 50; i += 1) {
        await client.get('/api/v1/auth/session')
      }
      expect((await read()).find((n) => n.key === 'proxy.not_trusted')).toMatchObject({
        level: 'warning',
        data: { address: '10.231.97.5' },
      })
    })
  })

  describe('the test mail of the system route', () => {
    it("only queues the mail: marking the e-mail as verified is the worker's job (markEmailVerified)", async () => {
      await setVerified(null)
      await raise(SETUP_EMAIL_SKIPPED_NOTICE.key, { level: 'warning' })
      const before = env.mail.sent.length
      expect((await admin.post('/api/v1/system/test-email', {})).status).toBe(202)
      expect(env.mail.sent).toHaveLength(before + 1)
      // Nothing in the api follows the job: the field, the skip row and the warning stay as they were.
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      const row = await env.query<{ value: unknown }>(`select value from setting where key = 'smtp_verified_at'`)
      expect(row[0]?.value ?? null).toBeNull()
      expect(
        await env.query('select 1 from admin_notice where key = $1', [SETUP_EMAIL_SKIPPED_NOTICE.key]),
      ).toHaveLength(1)
      expect(keys(await notices(admin))).toEqual([EMAIL_NOT_VERIFIED_NOTICE.key])
      expect(await env.query(`select 1 from audit_log where action = 'system.email_verified'`)).toEqual([])
      expect(
        await env.query(`select 1 from audit_log where action = 'system.test_email' and actor = 'dash-admin'`),
      ).toHaveLength(1)
    })
  })
})
