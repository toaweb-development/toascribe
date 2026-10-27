// The settings screens of M1.5 (K-191 to K-194, K-198, K-199): each group's values and defaults, what each refuses, the administrator
// address that changes only after its confirmation (K-192), the site's cache cleared by a change, and what the site and the
// registration form read from them.
import {
  CacheChanges,
  ContentItem,
  GeneralSettingsResponse,
  ONE_TIME_LINK_HOURS,
  PublicSettings,
} from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('settings screens')

describe.skipIf(TEST_DATABASE_URL === undefined)('the settings screens (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let otherAdmin: TestClient
  let editor: TestClient
  const pages: Record<string, string> = {}

  async function page(title: string, status: 'publish' | 'draft'): Promise<string> {
    const res = await admin.post('/api/v1/content', { type: 'page', title, status })
    expect(res.status, await res.clone().text()).toBe(201)
    return ContentItem.parse(await res.json()).id
  }

  beforeAll(async () => {
    env = await startAuthApp()
    await env.createAccount({ username: 'set-admin', role: 'administrator' })
    await env.createAccount({ username: 'set-admin2', role: 'administrator' })
    await env.createAccount({ username: 'set-editor', role: 'editor' })
    admin = env.client({ ip: '203.0.113.81' })
    otherAdmin = env.client({ ip: '203.0.113.82' })
    editor = env.client({ ip: '203.0.113.83' })
    expect((await admin.login('set-admin', TEST_PASSWORD)).status).toBe(200)
    expect((await otherAdmin.login('set-admin2', TEST_PASSWORD)).status).toBe(200)
    expect((await editor.login('set-editor', TEST_PASSWORD)).status).toBe(200)
    pages['front'] = await page('Forside', 'publish')
    pages['posts'] = await page('Blogg', 'publish')
    pages['draft'] = await page('Kladd', 'draft')
    pages['privacy'] = await page('Personvern', 'draft')
  })

  afterAll(async () => {
    await env.close()
  })

  describe('Generelt (K-191)', () => {
    it('gives the defaults, the site address and the languages, and only to manage_options', async () => {
      const res = await admin.get('/api/v1/settings/general')
      expect(res.status).toBe(200)
      const body = GeneralSettingsResponse.parse(await res.json())
      expect(body.settings).toMatchObject({
        users_can_register: false,
        default_role: 'subscriber',
        locale: 'nb',
        timezone_string: 'Europe/Oslo',
        start_of_week: 1,
      })
      expect(body.locales.map((locale) => locale.code)).toEqual(['nb'])
      expect(body.pendingAdminEmail).toBeNull()
      expect((await editor.get('/api/v1/settings/general')).status).toBe(403)
    })

    it('saves what it is sent, and refuses a role, a language or a time zone that does not exist', async () => {
      const res = await admin.patch('/api/v1/settings/general', {
        blogname: 'Bloggen min',
        users_can_register: true,
        default_role: 'author',
        time_format: 'H.i',
      })
      expect(res.status, await res.clone().text()).toBe(200)
      expect(GeneralSettingsResponse.parse(await res.json()).settings).toMatchObject({
        blogname: 'Bloggen min',
        users_can_register: true,
        default_role: 'author',
        time_format: 'H.i',
      })
      for (const body of [
        { default_role: 'administrator' },
        { default_role: 'finnes-ikke' },
        { locale: 'xx' },
        { timezone_string: 'Mars/Olympus' },
        { admin_email: 'ny@example.no' },
      ]) {
        expect((await admin.patch('/api/v1/settings/general', body)).status, JSON.stringify(body)).toBe(400)
      }
      await admin.patch('/api/v1/settings/general', { users_can_register: false, default_role: 'subscriber' })
    })
  })

  describe('the administrator address (K-192)', () => {
    it('changes only once the link sent to the new address is opened, by someone with manage_options', async () => {
      await env.query(
        `insert into setting (key, value) values ('admin_email', '"gammel-admin@example.no"'::jsonb)
         on conflict (key) do update set value = excluded.value`,
      )
      const before = GeneralSettingsResponse.parse(await (await admin.get('/api/v1/settings/general')).json())
      const sentBefore = env.mail.sent.length
      const res = await admin.patch('/api/v1/settings/general', { new_admin_email: 'ny-admin@example.no' })
      expect(res.status).toBe(200)
      const body = GeneralSettingsResponse.parse(await res.json())
      expect(body.settings.admin_email).toBe(before.settings.admin_email)
      expect(body.pendingAdminEmail).toBe('ny-admin@example.no')
      const mail = env.mail.sent.slice(sentBefore).find((sent) => sent.template === 'admin_email_change')
      expect(mail?.to).toBe('ny-admin@example.no')
      const token = (mail?.data as { token: string }).token

      expect((await editor.post('/api/v1/settings/general/admin-email/confirm', { token })).status).toBe(403)
      expect((await admin.post('/api/v1/settings/general/admin-email/confirm', { token: 'A'.repeat(43) })).status).toBe(
        400,
      )
      const confirmed = await otherAdmin.post('/api/v1/settings/general/admin-email/confirm', { token })
      expect(confirmed.status).toBe(200)
      // The old address hears where the notices go now (WordPress' «Admin Email Changed»), only after the confirmation.
      const notices = env.mail.sent.slice(sentBefore).filter((sent) => sent.template === 'admin_email_changed')
      expect(notices).toEqual([
        expect.objectContaining({ to: before.settings.admin_email, data: { newEmail: 'ny-admin@example.no' } }),
      ])
      expect(await confirmed.json()).toEqual({ adminEmail: 'ny-admin@example.no' })
      const after = GeneralSettingsResponse.parse(await (await admin.get('/api/v1/settings/general')).json())
      expect(after.settings.admin_email).toBe('ny-admin@example.no')
      expect(after.pendingAdminEmail).toBeNull()
      // Once only.
      expect((await admin.post('/api/v1/settings/general/admin-email/confirm', { token })).status).toBe(400)
    })

    it('uses only the last request, and stops a link once it has expired', async () => {
      const ask = async (email: string) => {
        await admin.patch('/api/v1/settings/general', { new_admin_email: email })
        const mail = env.mail.sent.filter((sent) => sent.template === 'admin_email_change').at(-1)
        return (mail?.data as { token: string }).token
      }
      const first = await ask('forste@example.no')
      const second = await ask('andre@example.no')
      expect((await admin.post('/api/v1/settings/general/admin-email/confirm', { token: first })).status).toBe(400)
      env.clock.advance((ONE_TIME_LINK_HOURS + 1) * 60 * 60 * 1000)
      try {
        expect((await admin.post('/api/v1/settings/general/admin-email/confirm', { token: second })).status).toBe(400)
      } finally {
        env.clock.advance(-(ONE_TIME_LINK_HOURS + 1) * 60 * 60 * 1000)
      }
    })
  })

  describe('a request that is refused writes nothing', () => {
    it('keeps the title when the new address is the one there is', async () => {
      const before = GeneralSettingsResponse.parse(await (await admin.get('/api/v1/settings/general')).json())
      const current = before.settings.admin_email ?? ''
      const res = await admin.patch('/api/v1/settings/general', {
        blogname: 'Skal ikke lagres',
        new_admin_email: current.toUpperCase(),
      })
      expect(res.status).toBe(400)
      const after = GeneralSettingsResponse.parse(await (await admin.get('/api/v1/settings/general')).json())
      expect(after.settings.blogname).toBe(before.settings.blogname)
    })

    it('mails a new address a few times per account, then asks it to wait', async () => {
      const asker = env.client({ ip: '203.0.113.84' })
      await env.createAccount({ username: 'set-admin3', role: 'administrator' })
      expect((await asker.login('set-admin3', TEST_PASSWORD)).status).toBe(200)
      const statuses: number[] = []
      for (let attempt = 0; attempt < 7; attempt += 1) {
        statuses.push(
          (await asker.patch('/api/v1/settings/general', { new_admin_email: `n${String(attempt)}@example.no` })).status,
        )
      }
      expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true)
      expect(statuses.at(-1)).toBe(429)
    })
  })

  describe('Skriving and Lesing (K-193, K-194, K-226)', () => {
    it('keeps the default category to a category that exists', async () => {
      expect((await admin.patch('/api/v1/settings/writing', { default_category: crypto.randomUUID() })).status).toBe(
        400,
      )
      expect((await admin.patch('/api/v1/settings/writing', { default_category: null })).status).toBe(400)
      const res = await admin.get('/api/v1/settings/writing')
      expect(((await res.json()) as { settings: Record<string, unknown> }).settings).toMatchObject({
        default_post_format: 'standard',
      })
    })

    it('takes a static front page and a posts page that are published pages, and not the same one', async () => {
      const set = (body: Record<string, unknown>) => admin.patch('/api/v1/settings/reading', body)
      expect((await set({ show_on_front: 'page' })).status).toBe(400)
      expect((await set({ show_on_front: 'page', page_on_front: pages['draft'] })).status).toBe(400)
      expect(
        (await set({ show_on_front: 'page', page_on_front: pages['front'], page_for_posts: pages['front'] })).status,
      ).toBe(400)
      // The same page written in capitals is the same page.
      expect(
        (
          await set({
            show_on_front: 'page',
            page_on_front: pages['front'],
            page_for_posts: (pages['front'] ?? '').toUpperCase(),
          })
        ).status,
      ).toBe(400)
      expect((await set({ posts_per_page: 0 })).status).toBe(400)
      const ok = await set({ show_on_front: 'page', page_on_front: pages['front'], page_for_posts: pages['posts'] })
      expect(ok.status, await ok.clone().text()).toBe(200)
      const site = PublicSettings.parse(await (await editor.get('/api/v1/public/settings')).json())
      expect(site).toMatchObject({ showOnFront: 'page', postsPagePath: '/blogg/' })
      await set({ show_on_front: 'posts', page_on_front: null, page_for_posts: null })
    })

    it("asks search engines to keep away when the site says so, and clears the site's cache", async () => {
      const start = CacheChanges.parse(await (await editor.get('/api/v1/public/cache/changes')).json())
      expect((await admin.patch('/api/v1/settings/reading', { blog_public: false })).status).toBe(200)
      expect(
        CacheChanges.parse(await (await editor.get(`/api/v1/public/cache/changes?since=${start.cursor}`)).json()).all,
      ).toBe(true)
      const site = PublicSettings.parse(await (await editor.get('/api/v1/public/settings')).json())
      expect(site.searchEngineVisible).toBe(false)
      await admin.patch('/api/v1/settings/reading', { blog_public: true })
    })
  })

  describe('Personvern (K-198, K-199)', () => {
    it('takes a page, a draft too, and links it on the site and the registration form once it is published', async () => {
      expect(
        (await admin.patch('/api/v1/settings/privacy', { wp_page_for_privacy_policy: pages['privacy'] })).status,
      ).toBe(200)
      const before = PublicSettings.parse(await (await editor.get('/api/v1/public/settings')).json())
      expect(before.privacyPolicyPath).toBeNull()
      expect((await admin.post(`/api/v1/content/${pages['privacy'] ?? ''}/publish`)).status).toBe(200)
      const after = PublicSettings.parse(await (await editor.get('/api/v1/public/settings')).json())
      expect(after.privacyPolicyPath).toBe('/personvern/')
      const options = (await (await editor.get('/api/v1/auth/options')).json()) as Record<string, unknown>
      expect(options['privacyPolicyPath']).toBe('/personvern/')
      const post = ContentItem.parse(
        await (await admin.post('/api/v1/content', { type: 'post', title: 'Innlegg' })).json(),
      )
      expect((await admin.patch('/api/v1/settings/privacy', { wp_page_for_privacy_policy: post.id })).status).toBe(400)
    })
  })
})
