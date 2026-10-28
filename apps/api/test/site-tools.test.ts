// «Oppdateringer» (M1.7, K-290) and «Nettstedshelse → Info» (M1.7, K-203). The update page shows what the last check stored and
// a changelog link only for a newer release; the check is turned off and on with update_core (audited, the site's cache kept),
// and TOASCRIBE_UPDATE_CHECK=off shows. Nettstedshelse has every group, and its copy has no secret, token, e-mail address,
// address or path, even when settings and the status hold them.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SITE_HEALTH_GROUPS,
  SITE_HEALTH_TESTS,
  SiteHealthInfoResponse,
  SiteHealthStatusResponse,
  UpdatesResponse,
} from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('site tools')

describe.skipIf(TEST_DATABASE_URL === undefined)('updates and site health (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let dir: string
  let admin: TestClient

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'toascribe-site-tools-'))
    await writeFile(join(dir, 'toascribe.toml'), '[backup]\nschedule = true\n')
    env = await startAuthApp({ configFile: join(dir, 'toascribe.toml') })
    const account = await env.createAccount({ username: 'helse-admin', role: 'administrator' })
    admin = env.client()
    expect((await admin.login(account.username, 'correct horse battery staple')).status).toBe(200)
  })
  afterAll(async () => {
    await env.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('shows no check before the first, then the stored one with a changelog link for a newer release', async () => {
    const before = UpdatesResponse.parse(await (await admin.get('/api/v1/updates')).json())
    expect(before).toMatchObject({ enabled: true, disabledByServer: false, status: null, changelogUrl: null })

    const status = {
      checkedAt: '2026-10-28T04:41:00.000Z',
      current: before.current,
      latest: '99.1.0',
      ok: true,
      error: null,
    }
    await env.query(`update setting set value = $1::jsonb where key = 'update_status'`, [JSON.stringify(status)])
    const after = UpdatesResponse.parse(await (await admin.get('/api/v1/updates')).json())
    expect(after.status).toEqual({ checkedAt: status.checkedAt, ok: true, latest: '99.1.0', available: true })
    expect(after.changelogUrl).toBe('https://github.com/toaweb-development/toascribe/blob/v99.1.0/CHANGELOG.md')

    await env.query(`update setting set value = $1::jsonb where key = 'update_status'`, [
      JSON.stringify({ ...status, latest: '0.0.1' }),
    ])
    const older = UpdatesResponse.parse(await (await admin.get('/api/v1/updates')).json())
    expect(older).toMatchObject({ status: { available: false }, changelogUrl: null })
  })

  it('turns the check off and on, audited without clearing the site cache; refuses a bad body and a missing CSRF token', async () => {
    const off = await admin.patch('/api/v1/updates/settings', { enabled: false })
    expect(off.status).toBe(200)
    expect(UpdatesResponse.parse(await off.json()).enabled).toBe(false)
    const [row] = await env.query<{ value: boolean }>(`select value from setting where key = 'update_check'`)
    expect(row?.value).toBe(false)
    const audit = await env.query<{ object_type: string; object_id: string }>(
      `select object_type, object_id from audit_log where action = 'settings.updated' and object_id = 'update_check'`,
    )
    expect(audit).toEqual([{ object_type: 'system', object_id: 'update_check' }])
    expect((await admin.patch('/api/v1/updates/settings', { enabled: 'nei' })).status).toBe(400)
    expect((await admin.patch('/api/v1/updates/settings', { enabled: true, extra: 1 })).status).toBe(400)
    expect((await admin.patch('/api/v1/updates/settings', { enabled: true }, { csrf: 'none' })).status).toBe(403)
    expect((await admin.patch('/api/v1/updates/settings', { enabled: true })).status).toBe(200)
  })

  it('gives every group, and a copy with no secret, token, e-mail address, address or path', async () => {
    // Values that must never reach the copy, planted where a careless field could pick them up.
    const planted = {
      backup_status: {
        at: '2026-10-28T03:30:00.000Z',
        ok: false,
        file: 'toascribe-20261028-033000Z-0.6.0.tar.zst',
        size: null,
        error: 'pg_dump failed: /var/lib/toascribe/backups/x postgres://toascribe_app:hemmelig@postgres/toascribe',
        scheduled: true,
      },
    }
    await env.query(`update setting set value = $1::jsonb where key = 'backup_status'`, [
      JSON.stringify(planted.backup_status),
    ])
    const res = await admin.get('/api/v1/site-health/info')
    expect(res.status).toBe(200)
    const info = SiteHealthInfoResponse.parse(await res.json())
    expect(info.groups.map((group) => group.key)).toEqual([...SITE_HEALTH_GROUPS])
    const backup = info.groups.find((group) => group.key === 'backup')
    expect(backup?.fields.find((field) => field.key === 'scheduled')?.value).toBe(true)
    const database = info.groups.find((group) => group.key === 'database')
    expect(database?.fields.find((field) => field.key === 'size')?.value).toEqual(expect.any(Number))
    const worker = info.groups.find((group) => group.key === 'worker')
    expect(worker?.fields.find((field) => field.key === 'status')?.value).toBe('notRunning')

    // Nothing in the screen's fields that is a secret either: the error text of the backup is not a field.
    const everything = `${JSON.stringify(info.groups)}\n${info.text}`
    for (const secret of [
      'hemmelig',
      'postgres://',
      '/var/lib/toascribe',
      '@example.test',
      'helse-admin',
      TEST_DATABASE_URL ?? 'never',
    ]) {
      expect(everything, secret).not.toContain(secret)
    }
    expect(info.text).toContain('### toascribe\nversion: ')
    expect(info.text).not.toMatch(/[0-9a-f]{32,}/)
  })

  it('gives the dashboard every check, critical first, from the same facts as Info (K-033)', async () => {
    const status = async () => {
      const res = await admin.get('/api/v1/site-health/status')
      expect(res.status).toBe(200)
      const body = SiteHealthStatusResponse.parse(await res.json())
      return Object.fromEntries(body.tests.map((test) => [test.key, test.status]))
    }
    const set = (key: string, value: unknown) =>
      env.query(`update setting set value = $1::jsonb where key = $2`, [JSON.stringify(value), key])
    const recent = { at: new Date().toISOString(), ok: true, file: 'a.tar.zst', size: 10, error: null, scheduled: true }
    await set('backup_status', recent)
    await set('blog_public', true)
    await set('smtp_verified_at', new Date().toISOString())
    const res = await admin.get('/api/v1/site-health/status')
    const body = SiteHealthStatusResponse.parse(await res.json())
    expect(body.tests.map((test) => test.key).sort()).toEqual([...SITE_HEALTH_TESTS].sort())
    // No worker in the tests: the one critical check, and first.
    expect(body.tests[0]).toEqual({ key: 'worker', status: 'critical' })
    expect(await status()).toMatchObject({
      migrations: 'good',
      backup: 'good',
      email: 'good',
      searchEngines: 'good',
      debug: 'good',
      cache: 'good',
    })
    // A failed backup is critical; an old one, or none, should be improved.
    await set('backup_status', { ...recent, ok: false })
    expect((await status())['backup']).toBe('critical')
    await set('backup_status', { ...recent, at: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    expect((await status())['backup']).toBe('recommended')
    await set('backup_status', null)
    expect((await status())['backup']).toBe('recommended')
    // Hidden from search engines, unverified e-mail and a newer release: should be improved.
    await set('blog_public', false)
    await set('smtp_verified_at', null)
    await set('update_status', {
      checkedAt: new Date().toISOString(),
      current: '0.0.1',
      ok: true,
      latest: '999.0.0',
      error: null,
    })
    expect(await status()).toMatchObject({ searchEngines: 'recommended', email: 'recommended', updates: 'recommended' })
    await set('blog_public', true)
    await set('update_status', null)
  })

  it('is refused without manage_options, and without signing in', async () => {
    const account = await env.createAccount({ username: 'helse-editor', role: 'editor' })
    const editor = env.client()
    expect((await editor.login(account.username, 'correct horse battery staple')).status).toBe(200)
    expect((await editor.get('/api/v1/site-health/info')).status).toBe(403)
    expect((await editor.get('/api/v1/site-health/status')).status).toBe(403)
    expect((await editor.get('/api/v1/updates')).status).toBe(403)
    expect((await env.client().get('/api/v1/site-health/info')).status).toBe(401)
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('TOASCRIBE_UPDATE_CHECK=off (needs TEST_DATABASE_URL)', () => {
  let other: AuthTestApp

  // In beforeAll: starting an app (a new database) takes longer than one test may.
  beforeAll(async () => {
    other = await startAuthApp({ serverAllowsUpdateCheck: false })
  })
  afterAll(async () => {
    await other.close()
  })

  it('says the server has turned the check off', async () => {
    const account = await other.createAccount({ username: 'helse-server', role: 'administrator' })
    const client = other.client()
    expect((await client.login(account.username, 'correct horse battery staple')).status).toBe(200)
    expect(UpdatesResponse.parse(await (await client.get('/api/v1/updates')).json()).disabledByServer).toBe(true)
  })
})
