// «Legg til ny bruker» (K-020), «Slett bruker» with its content moved or deleted (K-021), the bulk «Send tilbakestilling av
// passord» (K-022) and application passwords (K-016): Basic over HTTPS only, against the API only (never the account routes or
// the login), no CSRF and no origin needed, revoked at once, shown once, and failures counted like logins.
import {
  AppPasswordListResponse,
  CreateAppPasswordResponse,
  CreateUserResponse,
  DeleteUserResponse,
  SendPasswordResetResponse,
  UserDetail,
} from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('user admin')

const basic = (login: string, password: string) => `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`

describe.skipIf(TEST_DATABASE_URL === undefined)('users and application passwords (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let admin: TestClient
  let adminId: string

  async function signIn(username: string, role: Parameters<AuthTestApp['createAccount']>[0]['role'] = 'administrator') {
    const account = await env.createAccount({ username, role })
    const client = env.client()
    expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
    return { client, id: account.id }
  }
  async function post(client: TestClient, title: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await client.post('/api/v1/content', { type: 'post', title, ...extra })
    expect(res.status, await res.clone().text()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  beforeAll(async () => {
    env = await startAuthApp()
    const signed = await signIn('brukeradmin')
    admin = signed.client
    adminId = signed.id
  })
  afterAll(async () => {
    await env.close()
  })

  describe('Legg til ny bruker', () => {
    it('adds an active account with a password, who can sign in with it', async () => {
      const res = await admin.post('/api/v1/users', {
        username: 'nyforfatter',
        email: 'nyforfatter@example.test',
        firstName: 'Ny',
        role: 'author',
        sendInvite: false,
        password: 'et godt nytt passord',
      })
      expect(res.status).toBe(201)
      expect(CreateUserResponse.parse(await res.json())).toMatchObject({ username: 'nyforfatter', invited: false })
      expect((await env.client().login('nyforfatter', 'et godt nytt passord')).status).toBe(200)
    })

    it('invites: the account waits for its password and gets a set-password link by mail', async () => {
      const before = env.mail.sent.length
      const res = await admin.post('/api/v1/users', {
        username: 'invitert',
        email: 'invitert@example.test',
        role: 'editor',
        sendInvite: true,
      })
      expect(res.status).toBe(201)
      const [row] = await env.query<{ status: string }>(`select status from account where username = 'invitert'`)
      expect(row?.status).toBe('pending')
      expect(env.mail.sent.slice(before)).toEqual([
        {
          template: 'set_password',
          to: 'invitert@example.test',
          data: { username: 'invitert', token: expect.any(String) },
        },
      ])
    })

    it('refuses a taken name or address, a password with an invite, an obvious password and a role the caller lacks', async () => {
      const base = { email: 'ledig@example.test', role: 'author', sendInvite: false, password: 'et godt nytt passord' }
      expect((await admin.post('/api/v1/users', { ...base, username: 'nyforfatter' })).status).toBe(409)
      expect(
        (await admin.post('/api/v1/users', { ...base, username: 'ledig', email: 'nyforfatter@example.test' })).status,
      ).toBe(409)
      expect((await admin.post('/api/v1/users', { ...base, username: 'ledig', sendInvite: true })).status).toBe(400)
      expect((await admin.post('/api/v1/users', { ...base, username: 'ledig', password: undefined })).status).toBe(400)
      const obvious = await admin.post('/api/v1/users', { ...base, username: 'ledigsomfaa', password: 'ledigsomfaa' })
      expect(obvious.status).toBe(400)
      const { client: editor } = await signIn('redaktor-uten-rett', 'editor')
      expect((await editor.post('/api/v1/users', { ...base, username: 'ledig2' })).status).toBe(403)
    })
  })

  describe('Slett bruker', () => {
    it('moves the content (and the files) to another account', async () => {
      const { client: author, id } = await signIn('flyttes', 'author')
      const postId = await post(author, 'Innlegg som flyttes')
      const detail = UserDetail.parse(await (await admin.get(`/api/v1/users/${id}`)).json())
      expect(detail.contentCount).toBe(1)
      const res = await admin.delete(`/api/v1/users/${id}`, { json: { reassignTo: adminId } })
      expect(res.status).toBe(200)
      expect(DeleteUserResponse.parse(await res.json())).toEqual({ reassigned: 1, deleted: 0 })
      const authors = await env.query<{ account_id: string }>(
        `select account_id from content_author where content_id = $1`,
        [postId],
      )
      expect(authors).toEqual([{ account_id: adminId }])
      expect(await env.query(`select 1 from account where id = $1`, [id])).toEqual([])
      const audit = await env.query<{ action: string }>(`select action from audit_log where object_id = $1`, [id])
      expect(audit.map((row) => row.action)).toContain('user.deleted')
    })

    it('deletes what the account wrote alone, and keeps shared content with its other authors', async () => {
      const { client: author, id } = await signIn('slettes', 'author')
      const alone = await post(author, 'Bare min')
      const shared = await post(admin, 'Vår felles', { authors: [adminId, id] })
      const res = await admin.delete(`/api/v1/users/${id}`, { json: { reassignTo: null } })
      expect(res.status).toBe(200)
      expect(DeleteUserResponse.parse(await res.json())).toEqual({ reassigned: 0, deleted: 1 })
      expect(await env.query(`select 1 from content where id = $1`, [alone])).toEqual([])
      expect(await env.query(`select account_id from content_author where content_id = $1`, [shared])).toEqual([
        { account_id: adminId },
      ])
    })

    it('never deletes oneself or the last administrator, nor an account with more rights, and needs delete_users', async () => {
      expect((await admin.delete(`/api/v1/users/${adminId}`, { json: { reassignTo: null } })).status).toBe(409)
      const { id: editorId } = await signIn('vanlig-redaktor', 'editor')
      const { client: editor } = await signIn('redaktor-sletter', 'editor')
      expect((await editor.delete(`/api/v1/users/${editorId}`, { json: { reassignTo: null } })).status).toBe(403)
      expect((await admin.delete(`/api/v1/users/${editorId}`, { json: { reassignTo: editorId } })).status).toBe(400)

      // A role with every capability of the administrator, but not the administrator role: the only active administrator left
      // cannot be deleted by it.
      const { id: lastAdmin } = await signIn('siste-admin')
      await env.query(
        `insert into role (slug, name, capabilities) select 'nestenadmin', 'Nesten admin', capabilities from role where slug = 'administrator'`,
      )
      const deputy = await env.createAccount({ username: 'nestleder', role: null })
      await env.query(
        `insert into account_role (account_id, role_id) select $1, id from role where slug = 'nestenadmin'`,
        [deputy.id],
      )
      await env.query(
        `update account set status = 'disabled' where id <> $1 and id in (select account_id from account_role ar join role r on r.id = ar.role_id where r.slug = 'administrator')`,
        [lastAdmin],
      )
      const client = env.client()
      expect((await client.login('nestleder', TEST_PASSWORD)).status).toBe(200)
      const refused = await client.delete(`/api/v1/users/${lastAdmin}`, { json: { reassignTo: null } })
      expect(refused.status).toBe(409)
      expect(await refused.text()).toContain('last_administrator')
      await env.query(`update account set status = 'active' where status = 'disabled'`)
    })
  })

  it('sends password reset links in bulk, skipping disabled and unknown accounts', async () => {
    const active = await env.createAccount({ username: 'glemsk', role: 'author' })
    const disabled = await env.createAccount({ username: 'stengt', role: 'author', status: 'disabled' })
    const [pending] = await env.query<{ id: string }>(`select id from account where username = 'invitert'`)
    const before = env.mail.sent.length
    const res = await admin.post('/api/v1/users/password-reset', {
      ids: [active.id, disabled.id, pending?.id ?? '', '7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    })
    expect(res.status).toBe(200)
    const body = SendPasswordResetResponse.parse(await res.json())
    expect(body.sent).toBe(2)
    expect(body.skipped.map((entry) => entry.reason).sort()).toEqual(['disabled', 'not_found'])
    expect(
      env.mail.sent
        .slice(before)
        .map((mail) => mail.template)
        .sort(),
    ).toEqual(['password_reset', 'set_password'])
  })

  describe('application passwords', () => {
    let owner: TestClient
    let password: string
    let id: string
    const https = { 'x-forwarded-proto': 'https' }

    beforeAll(async () => {
      const signed = await signIn('apiklient', 'editor')
      owner = signed.client
      const res = await owner.post('/api/v1/me/app-passwords', { name: 'Publiseringsskript' })
      expect(res.status).toBe(201)
      const made = CreateAppPasswordResponse.parse(await res.json())
      password = made.password
      id = made.item.id
      expect(password).toMatch(/^([A-Za-z0-9]{4} ){5}[A-Za-z0-9]{4}$/)
    })

    it('is shown once: the list has the name and no password', async () => {
      const text = await (await owner.get('/api/v1/me/app-passwords')).text()
      const list = AppPasswordListResponse.parse(JSON.parse(text))
      expect(list.items.map((item) => item.name)).toEqual(['Publiseringsskript'])
      expect(text).not.toContain(password)
      expect(text).not.toContain(password.replace(/ /g, ''))
      const [row] = await env.query<{ password_hash: string }>(`select password_hash from app_password where id = $1`, [
        id,
      ])
      expect(row?.password_hash).not.toContain(password.replace(/ /g, ''))
    })

    it('signs an API client in with Basic over HTTPS, with no CSRF token and no Origin', async () => {
      const client = env.client({ origin: null })
      const headers = { ...https, authorization: basic('apiklient', password) }
      expect((await client.get('/api/v1/content?type=post', { headers, cookie: null })).status).toBe(200)
      const made = await client.post(
        '/api/v1/content',
        { type: 'post', title: 'Fra skriptet' },
        { headers, cookie: null, csrf: 'none', origin: null },
      )
      expect(made.status, await made.clone().text()).toBe(201)
      // Spaces or not, the same password.
      const plain = { ...https, authorization: basic('apiklient', password.replace(/ /g, '')) }
      expect((await client.get('/api/v1/content?type=post', { headers: plain, cookie: null })).status).toBe(200)
      const [row] = await env.query<{ last_used_at: Date | null }>(
        `select last_used_at from app_password where id = $1`,
        [id],
      )
      expect(row?.last_used_at).not.toBeNull()
    })

    it('is refused over plain HTTP, for the account routes, for the login, and from a client holding one', async () => {
      const client = env.client({ origin: null })
      const auth = { authorization: basic('apiklient', password) }
      expect((await client.get('/api/v1/content?type=post', { headers: auth, cookie: null })).status).toBe(403)
      const me = await client.get('/api/v1/me', { headers: { ...https, ...auth }, cookie: null })
      expect(me.status).toBe(401)
      const make = await client.post(
        '/api/v1/me/app-passwords',
        { name: 'Nytt' },
        { headers: { ...https, ...auth }, cookie: null },
      )
      // The account routes are a browser's: without an Origin the request is refused before anyone is looked up.
      expect(make.status).toBe(400)
      expect((await env.client().login('apiklient', password)).status).toBe(401)
    })

    it('refuses a wrong password without asking the browser for one, and counts it as a failed login', async () => {
      const client = env.client({ origin: null })
      const wrong = await client.get('/api/v1/content?type=post', {
        headers: { ...https, authorization: basic('apiklient', 'feil feil feil feil feil feil') },
        cookie: null,
      })
      expect(wrong.status).toBe(401)
      expect(wrong.headers.get('www-authenticate')).toBeNull()
      const attempts = await env.query(`select 1 from login_attempt where action = 'login' and succeeded = false`)
      expect(attempts.length).toBeGreaterThan(0)
    })

    it('stops working the moment it is revoked', async () => {
      const client = env.client({ origin: null })
      const headers = { ...https, authorization: basic('apiklient', password) }
      expect((await owner.delete(`/api/v1/me/app-passwords/${id}`)).status).toBe(204)
      expect((await client.get('/api/v1/content?type=post', { headers, cookie: null })).status).toBe(401)
      expect((await owner.delete(`/api/v1/me/app-passwords/${id}`)).status).toBe(404)
    })
  })
})
