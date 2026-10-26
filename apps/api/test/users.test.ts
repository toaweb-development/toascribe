// The users table and role assignment (M0.5): GET /api/v1/users and PUT /api/v1/users/roles.
import { CAPABILITIES, DEFAULT_ROLES, AssignRoleResponse, UserListResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { escapeLike } from '../src/repositories/users.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, CreatedAccount, TestClient } from './harness.ts'

noticeIfSkipped('users')

const AUTHOR_CAPABILITIES = DEFAULT_ROLES.find((role) => role.slug === 'author')?.capabilities ?? []

describe('escapeLike', () => {
  it('escapes the wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(escapeLike('plain')).toBe('plain')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('users (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let sequence = 0

  beforeAll(async () => {
    env = await startAuthApp()
    // A role that holds everything the administrator does but is not the administrator: the stand-in for an extension that
    // gives `promote_users` away. And one that may hand out the author's rights and nothing above them.
    await env.query(
      `insert into role (slug, name, capabilities) values ('superuser', 'Superuser', $1), ('people-manager', 'People manager', $2)`,
      [[...CAPABILITIES], [...AUTHOR_CAPABILITIES, 'list_users', 'promote_users']],
    )
  })
  afterAll(async () => {
    await env.close()
  })

  /** An account with the roles given (slugs, built in or made above), signed in on a client of its own. */
  async function signedIn(
    prefix: string,
    roles: readonly string[],
    extra: { status?: 'active' | 'pending' | 'disabled'; displayName?: string; email?: string } = {},
  ): Promise<{ account: CreatedAccount; client: TestClient }> {
    sequence += 1
    const username = `${prefix}-${String(sequence)}`
    const account = await env.createAccount({ username, role: null, ...extra })
    await setRoles(account.id, roles)
    const client = env.client({ ip: `203.0.113.${String(10 + (sequence % 200))}` })
    if ((extra.status ?? 'active') === 'active') {
      expect((await client.login(username, TEST_PASSWORD)).status).toBe(200)
    }
    return { account, client }
  }
  async function setRoles(accountId: string, slugs: readonly string[]) {
    await env.query('delete from account_role where account_id = $1', [accountId])
    for (const slug of slugs) {
      await env.query('insert into account_role (account_id, role_id) select $1, id from role where slug = $2', [
        accountId,
        slug,
      ])
    }
  }
  const rolesOf = async (accountId: string) =>
    (
      await env.query<{ slug: string }>(
        'select r.slug from account_role ar join role r on r.id = ar.role_id where ar.account_id = $1 order by r.slug',
        [accountId],
      )
    ).map((row) => row.slug)
  const activeAdministrators = async () =>
    (
      await env.query<{ n: string }>(
        `select count(*) as n from account a join account_role ar on ar.account_id = a.id join role r on r.id = ar.role_id
         where r.slug = 'administrator' and a.status = 'active'`,
      )
    )[0]?.n
  /** Every administrator is made a subscriber, then these are made administrators: a known starting point. */
  async function resetAdministrators(...ids: string[]) {
    await env.query(`delete from account_role where role_id = (select id from role where slug = 'administrator')`)
    for (const id of ids) {
      await setRoles(id, ['administrator'])
    }
  }

  const assign = (client: TestClient, userIds: readonly string[], role: string) =>
    client.put('/api/v1/users/roles', { userIds, role })
  const assigned = async (client: TestClient, userIds: readonly string[], role: string) => {
    const res = await assign(client, userIds, role)
    expect(res.status).toBe(200)
    return AssignRoleResponse.parse(await res.json())
  }
  const list = async (client: TestClient, query = '') => {
    const res = await client.get(`/api/v1/users${query}`)
    expect(res.status).toBe(200)
    return UserListResponse.parse(await res.json())
  }

  describe('GET /api/v1/users', () => {
    it('gives an administrator the table, with nothing secret in it', async () => {
      const { client } = await signedIn('lister', ['administrator'])
      const res = await client.get('/api/v1/users?per_page=100')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = UserListResponse.parse(await res.json())
      const row = body.users.find((user) => user.username.startsWith('lister-'))
      expect(row).toBeDefined()
      expect(Object.keys(row ?? {}).sort()).toEqual([
        'displayName',
        'email',
        'id',
        'postCount',
        'registeredAt',
        'roles',
        'status',
        'username',
      ])
      expect(row?.roles).toEqual(['administrator'])
      expect(row?.status).toBe('active')
      const text = JSON.stringify(body)
      expect(text).not.toMatch(/password|hash|mfa|token|secret/i)
    })

    it('refuses every role but the administrator, and anonymous callers', async () => {
      for (const role of ['editor', 'author', 'contributor', 'subscriber']) {
        const { client } = await signedIn(`no-list-${role}`, [role])
        expect((await client.get('/api/v1/users')).status).toBe(403)
      }
      expect((await env.client().get('/api/v1/users')).status).toBe(401)
    })

    it('searches username, e-mail, display name and nicename, anywhere in the text and without regard to case', async () => {
      const { client } = await signedIn('searcher', ['administrator'])
      const a = await env.createAccount({
        username: 'zq-login-ALPHA',
        email: 'plain1@example.test',
        displayName: 'Plain One',
      })
      const b = await env.createAccount({
        username: 'zq-b',
        email: 'Needle-Mail@Example.test',
        displayName: 'Plain Two',
      })
      const c = await env.createAccount({
        username: 'zq-c',
        email: 'plain3@example.test',
        displayName: 'Kari Haystack',
      })
      const d = await env.createAccount({ username: 'zq-d', email: 'plain4@example.test', displayName: 'Plain Four' })
      await env.query(`update account set nicename = 'a-quite-special-slug' where id = $1`, [d.id])
      const ids = async (search: string) =>
        (await list(client, `?search=${encodeURIComponent(search)}`)).users.map((user) => user.id).sort()
      expect(await ids('login-alpha')).toEqual([a.id])
      expect(await ids('NEEDLE-mail@')).toEqual([b.id])
      expect(await ids('haystack')).toEqual([c.id])
      expect(await ids('quite-special')).toEqual([d.id])
      expect(await ids('  zq-c  ')).toEqual([c.id])
      expect(await ids('no-such-text-anywhere')).toEqual([])
    })

    it('treats % and _ in the search as text, not as wildcards', async () => {
      const { client } = await signedIn('wild', ['administrator'])
      const under = await env.createAccount({ username: 'wc_under' })
      const other = await env.createAccount({ username: 'wcXunder' })
      const percent = await env.createAccount({ username: 'wc%pct' })
      const ids = async (search: string) =>
        (await list(client, `?search=${encodeURIComponent(search)}`)).users.map((user) => user.id).sort()
      expect(await ids('wc_under')).toEqual([under.id])
      expect(await ids('wc%pct')).toEqual([percent.id])
      expect(await ids('%')).toEqual([percent.id])
      expect(await ids('wc_')).toEqual([under.id])
      expect(other.id).toBeDefined()
      expect(await ids('\\')).toEqual([])
    })

    it('treats an empty search as none', async () => {
      const { client } = await signedIn('emptysearch', ['administrator'])
      const all = await list(client, '?per_page=100')
      expect((await list(client, '?search=&per_page=100')).total).toBe(all.total)
      expect((await list(client, '?search=%20%20&per_page=100')).total).toBe(all.total)
    })

    it('filters by role, and `none` gives the accounts without one', async () => {
      const { client } = await signedIn('filterer', ['administrator'])
      const editor = await env.createAccount({ username: 'filter-editor', role: 'editor' })
      const norole = await env.createAccount({ username: 'filter-norole', role: null })
      const editors = await list(client, '?role=editor&per_page=100')
      expect(editors.users.map((user) => user.id)).toContain(editor.id)
      expect(editors.users.every((user) => user.roles.includes('editor'))).toBe(true)
      expect(editors.total).toBe(editors.users.length)
      const none = await list(client, '?role=none&per_page=100')
      expect(none.users.map((user) => user.id)).toContain(norole.id)
      expect(none.users.every((user) => user.roles.length === 0)).toBe(true)
      const unknown = await list(client, '?role=no-such-role')
      expect(unknown.users).toEqual([])
      expect(unknown.total).toBe(0)
    })

    it('orders by username, name, e-mail and registration, both ways, ignoring case', async () => {
      const { client } = await signedIn('orderer', ['administrator'])
      await env.createAccount({ username: 'ord-b', email: 'ord-3@example.test', displayName: 'ord Charlie' })
      await env.createAccount({ username: 'ORD-a', email: 'ord-2@example.test', displayName: 'ord alice' })
      await env.createAccount({ username: 'ord-c', email: 'ord-1@example.test', displayName: 'ord Bob' })
      await env.query(
        `update account set created_at = now() - (case username when 'ord-b' then interval '3 days' when 'ORD-a' then interval '1 day' else interval '2 days' end)
         where username in ('ord-b', 'ORD-a', 'ord-c')`,
      )
      const usernames = async (query: string) =>
        (await list(client, `?search=ord&${query}&per_page=100`)).users
          .map((user) => user.username)
          .filter((name) => name.toLowerCase().startsWith('ord-'))
      expect(await usernames('orderby=username')).toEqual(['ORD-a', 'ord-b', 'ord-c'])
      expect(await usernames('orderby=username&order=desc')).toEqual(['ord-c', 'ord-b', 'ORD-a'])
      expect(await usernames('orderby=name')).toEqual(['ORD-a', 'ord-c', 'ord-b'])
      expect(await usernames('orderby=email&order=asc')).toEqual(['ord-c', 'ORD-a', 'ord-b'])
      expect(await usernames('orderby=registered&order=asc')).toEqual(['ord-b', 'ord-c', 'ORD-a'])
      expect(await usernames('orderby=registered&order=desc')).toEqual(['ORD-a', 'ord-c', 'ord-b'])
    })

    it('pages: total counts every match, page and the page size are echoed, with X-Total-Count and X-Total-Pages, a page past the end is empty', async () => {
      const { client } = await signedIn('pager', ['administrator'])
      for (let i = 0; i < 5; i += 1) {
        await env.createAccount({ username: `pg-${String(i)}` })
      }
      const first = await list(client, '?search=pg-&per_page=2&page=1')
      expect(first).toMatchObject({ total: 5, page: 1, perPage: 2 })
      expect(first.users.map((user) => user.username)).toEqual(['pg-0', 'pg-1'])
      const third = await list(client, '?search=pg-&per_page=2&page=3')
      expect(third.users.map((user) => user.username)).toEqual(['pg-4'])
      const headers = await client.get('/api/v1/users?search=pg-&per_page=2&page=1')
      expect([headers.headers.get('x-total-count'), headers.headers.get('x-total-pages')]).toEqual(['5', '3'])
      // The old name is refused: every list of the API says per_page.
      expect((await client.get('/api/v1/users?perPage=2')).status).toBe(400)
      const past = await list(client, '?search=pg-&per_page=2&page=9')
      expect(past.users).toEqual([])
      expect(past.total).toBe(5)
      const defaults = await list(client, '?search=pg-')
      expect(defaults).toMatchObject({ page: 1, perPage: 20 })
    })

    it('answers 400 to an unknown parameter, order, or a size out of range', async () => {
      const { client } = await signedIn('badquery', ['administrator'])
      for (const query of [
        '?per_page=101',
        '?per_page=0',
        '?page=0',
        '?page=abc',
        '?orderby=password',
        '?order=sideways',
        '?role=Not%20A%20Slug',
        '?extra=1',
        `?search=${'x'.repeat(101)}`,
      ]) {
        const res = await client.get(`/api/v1/users${query}`)
        expect(res.status, query).toBe(400)
      }
    })

    it('gives the views, which ignore search, role and page', async () => {
      const { client } = await signedIn('viewer', ['administrator'])
      await env.createAccount({ username: 'view-norole', role: null })
      await env.createAccount({ username: 'view-multi', role: ['editor', 'author'] })
      const everything = await list(client, '?per_page=100')
      const counts = everything.roleCounts
      expect(counts.all).toBe(everything.total)
      expect(counts.none).toBeGreaterThanOrEqual(1)
      expect(counts.roles['editor']).toBeGreaterThanOrEqual(1)
      expect(counts.roles['author']).toBeGreaterThanOrEqual(1)
      // A role no account holds is not a view; the others have the number of accounts that hold them.
      const held = await env.query<{ slug: string; n: string }>(
        `select r.slug, count(distinct ar.account_id) as n from role r join account_role ar on ar.role_id = r.id group by r.slug`,
      )
      expect(counts.roles).toEqual(Object.fromEntries(held.map((row) => [row.slug, Number(row.n)])))
      const unheld = await env.query<{ slug: string }>(
        `select slug from role where not exists (select 1 from account_role where role_id = role.id)`,
      )
      expect(unheld.length).toBeGreaterThan(0)
      for (const { slug } of unheld) {
        expect(counts.roles[slug]).toBeUndefined()
      }
      const narrowed = await list(client, '?search=view-multi&role=editor&page=2&per_page=1')
      expect(narrowed.roleCounts).toEqual(counts)
      expect(narrowed.total).toBe(1)
    })

    it('lists the roles in WordPress order, others by name, and says which ones the caller may give', async () => {
      const { client } = await signedIn('roles-admin', ['administrator'])
      await env.query(
        `insert into role (slug, name, capabilities) values ('zeta', 'Alpha shop', '{read}'), ('beta', 'Beta shop', '{read}') on conflict do nothing`,
      )
      const body = await list(client)
      expect(body.roles.map((role) => role.slug)).toEqual([
        'administrator',
        'editor',
        'author',
        'contributor',
        'subscriber',
        'zeta',
        'beta',
        'people-manager',
        'superuser',
      ])
      expect(body.roles.find((role) => role.slug === 'editor')?.name).toBe('Editor')
      expect(body.roles.every((role) => role.grantable)).toBe(true)

      const manager = await signedIn('roles-manager', ['people-manager'])
      const asManager = await list(manager.client)
      const grantable = Object.fromEntries(asManager.roles.map((role) => [role.slug, role.grantable]))
      expect(grantable).toMatchObject({
        administrator: false,
        editor: false,
        author: true,
        contributor: true,
        subscriber: true,
        zeta: true,
        superuser: false,
      })
    })

    it('counts the published posts an account is an author of, and nothing else', async () => {
      const { client, account } = await signedIn('poster', ['administrator'])
      await env.query(
        `with c as (
           insert into content (type, locale, slug, title, status, status_before_trash, comment_status)
           values ('post', 'nb', 'pc-published', 'x', 'publish', null, 'open'), ('post', 'nb', 'pc-published-2', 'x', 'publish', null, 'open'),
                  ('post', 'en', 'pc-draft', 'x', 'draft', null, 'open'), ('post', 'nb', 'pc-trash', 'x', 'trash', 'publish', 'open'),
                  ('page', 'nb', 'pc-page', 'x', 'publish', null, 'open')
           returning id)
         insert into content_author (content_id, account_id) select id, $1 from c`,
        [account.id],
      )
      const row = (await list(client, `?search=${account.username}`)).users.find((user) => user.id === account.id)
      expect(row?.postCount).toBe(2)
      const other = await env.createAccount({ username: 'poster-none' })
      expect((await list(client, '?search=poster-none')).users.find((user) => user.id === other.id)?.postCount).toBe(0)
    })
  })

  describe('PUT /api/v1/users/roles', () => {
    it('replaces the roles of the accounts and says which', async () => {
      const { client } = await signedIn('promoter', ['administrator'])
      const a = await env.createAccount({ username: 'promo-a', role: 'subscriber' })
      const b = await env.createAccount({ username: 'promo-b', role: ['editor', 'author'] })
      const res = await assign(client, [a.id, b.id], 'contributor')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(AssignRoleResponse.parse(await res.json())).toEqual({ changed: [a.id, b.id], unchanged: [], skipped: [] })
      expect(await rolesOf(a.id)).toEqual(['contributor'])
      // WordPress keeps one role per account in its screen: the second role is replaced, not kept.
      expect(await rolesOf(b.id)).toEqual(['contributor'])
    })

    it('rule 1: never changes the signed-in account, and changes the others', async () => {
      const { client, account } = await signedIn('selfie', ['administrator'])
      await signedIn('selfie-other-admin', ['administrator'])
      const other = await env.createAccount({ username: 'selfie-other', role: 'subscriber' })
      const body = await assigned(client, [account.id, other.id], 'editor')
      expect(body).toEqual({ changed: [other.id], unchanged: [], skipped: [{ id: account.id, reason: 'self' }] })
      expect(await rolesOf(account.id)).toEqual(['administrator'])
      expect(await rolesOf(other.id)).toEqual(['editor'])
      // Naming only oneself changes nothing and is still a 200.
      expect(await assigned(client, [account.id], 'subscriber')).toEqual({
        changed: [],
        unchanged: [],
        skipped: [{ id: account.id, reason: 'self' }],
      })
      expect(
        await env.query(`select 1 from audit_log where action = 'user.role_changed' and object_id = $1`, [account.id]),
      ).toEqual([])
    })

    it('rule 2: the last active administrator keeps the role; a disabled one does not count', async () => {
      const { client: superClient } = await signedIn('lastadmin-super', ['superuser'])
      const sole = await env.createAccount({ username: 'lastadmin-sole', role: 'administrator' })
      const gone = await env.createAccount({
        username: 'lastadmin-disabled',
        role: 'administrator',
        status: 'disabled',
      })
      await resetAdministrators(sole.id, gone.id)

      // The disabled administrator is not one the site depends on, so it may be demoted ...
      expect(await assigned(superClient, [gone.id], 'subscriber')).toMatchObject({ changed: [gone.id] })
      // ... and the active one may not.
      expect(await assigned(superClient, [sole.id], 'subscriber')).toEqual({
        changed: [],
        unchanged: [],
        skipped: [{ id: sole.id, reason: 'last_administrator' }],
      })
      expect(await rolesOf(sole.id)).toEqual(['administrator'])
      expect(await activeAdministrators()).toBe('1')
    })

    it('rule 2: of two administrators named in one request, one stays', async () => {
      const { client: superClient } = await signedIn('batchadmin-super', ['superuser'])
      const one = await env.createAccount({ username: 'batchadmin-1', role: 'administrator' })
      const two = await env.createAccount({ username: 'batchadmin-2', role: 'administrator' })
      await resetAdministrators(one.id, two.id)
      const body = await assigned(superClient, [one.id, two.id], 'editor')
      expect(body).toEqual({
        changed: [one.id],
        unchanged: [],
        skipped: [{ id: two.id, reason: 'last_administrator' }],
      })
      expect(await activeAdministrators()).toBe('1')
    })

    it('rule 2: promoting to administrator is not held back by the rule, and a non-administrator target is not counted', async () => {
      const { client } = await signedIn('promoadmin', ['administrator'])
      const sub = await env.createAccount({ username: 'promoadmin-sub', role: 'subscriber' })
      expect(await assigned(client, [sub.id], 'administrator')).toMatchObject({ changed: [sub.id] })
      expect(await rolesOf(sub.id)).toEqual(['administrator'])
    })

    it('rule 2, race: two requests that each demote one of the two administrators cannot both succeed', async () => {
      const { client: first } = await signedIn('race-super-1', ['superuser'])
      const { client: second } = await signedIn('race-super-2', ['superuser'])
      const a = await env.createAccount({ username: 'race-admin-a', role: 'administrator' })
      const b = await env.createAccount({ username: 'race-admin-b', role: 'administrator' })
      for (let round = 0; round < 12; round += 1) {
        await resetAdministrators(a.id, b.id)
        const [x, y] = await Promise.all([assign(first, [a.id], 'subscriber'), assign(second, [b.id], 'subscriber')])
        expect([x.status, y.status]).toEqual([200, 200])
        const results = [AssignRoleResponse.parse(await x.json()), AssignRoleResponse.parse(await y.json())]
        const changed = results.flatMap((result) => result.changed)
        const refused = results.flatMap((result) => result.skipped.map((entry) => entry.reason))
        expect(changed.length, `round ${String(round)}`).toBe(1)
        expect(refused, `round ${String(round)}`).toEqual(['last_administrator'])
        expect(await activeAdministrators(), `round ${String(round)}`).toBe('1')
      }
    })

    it('rule 2, race: two administrators demoting each other leave one administrator', async () => {
      const a = await signedIn('swap-a', ['administrator'])
      const b = await signedIn('swap-b', ['administrator'])
      for (let round = 0; round < 8; round += 1) {
        await resetAdministrators(a.account.id, b.account.id)
        const [x, y] = await Promise.all([
          assign(a.client, [b.account.id], 'subscriber'),
          assign(b.client, [a.account.id], 'subscriber'),
        ])
        // The one that took the lock first demotes the other; the other then finds that it no longer holds promote_users.
        expect([x.status, y.status].sort(), `round ${String(round)}`).toEqual([200, 403])
        expect(await activeAdministrators(), `round ${String(round)}`).toBe('1')
      }
    })

    it('rule 3: an unknown role is a 400 and changes nothing; an unknown or deleted account is skipped', async () => {
      const { client } = await signedIn('unknowns', ['administrator'])
      const real = await env.createAccount({ username: 'unknowns-real', role: 'subscriber' })
      const res = await assign(client, [real.id], 'no-such-role')
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'unknown_role' } })
      expect(await rolesOf(real.id)).toEqual(['subscriber'])

      const gone = await env.createAccount({ username: 'unknowns-gone', role: 'subscriber' })
      await env.query('delete from account where id = $1', [gone.id])
      const never = '0198a3c2-0000-7000-8000-0000000000aa'
      expect(await assigned(client, [never, real.id, gone.id], 'author')).toEqual({
        changed: [real.id],
        unchanged: [],
        skipped: [
          { id: never, reason: 'not_found' },
          { id: gone.id, reason: 'not_found' },
        ],
      })
    })

    it('rule 3: a malformed body is a 400', async () => {
      const { client } = await signedIn('badbody', ['administrator'])
      const real = await env.createAccount({ username: 'badbody-real', role: 'subscriber' })
      const many = Array.from({ length: 101 }, (_, i) => `0198a3c2-0000-7000-8000-${String(i).padStart(12, '0')}`)
      const bodies: unknown[] = [
        {},
        { userIds: [real.id] },
        { role: 'editor' },
        { userIds: [], role: 'editor' },
        { userIds: [real.id, real.id], role: 'editor' },
        { userIds: many, role: 'editor' },
        { userIds: ['not-a-uuid'], role: 'editor' },
        { userIds: [real.id], role: 'Editor!' },
        { userIds: [real.id], role: 'editor', extra: true },
        { userIds: real.id, role: 'editor' },
        [],
      ]
      for (const body of bodies) {
        const res = await client.put('/api/v1/users/roles', body)
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400)
      }
      expect(await rolesOf(real.id)).toEqual(['subscriber'])
      // 100 is the limit and is accepted.
      expect((await assign(client, many.slice(0, 100), 'editor')).status).toBe(200)
    })

    it('rule 4: a role is given only by someone who holds all its capabilities', async () => {
      const { client } = await signedIn('esc-manager', ['people-manager'])
      const target = await env.createAccount({ username: 'esc-target', role: 'subscriber' })
      for (const role of ['administrator', 'editor', 'superuser']) {
        const res = await assign(client, [target.id], role)
        expect(res.status, role).toBe(403)
        expect(await res.json()).toMatchObject({ error: { code: 'forbidden_role' } })
      }
      expect(await rolesOf(target.id)).toEqual(['subscriber'])
      // The roles inside what the manager holds are fine.
      expect(await assigned(client, [target.id], 'author')).toMatchObject({ changed: [target.id] })
      expect(await assigned(client, [target.id], 'contributor')).toMatchObject({ changed: [target.id] })
    })

    it('rule 4: an account is changed only by someone who holds all its capabilities', async () => {
      const { client } = await signedIn('esc2-manager', ['people-manager'])
      const admin = await env.createAccount({ username: 'esc2-admin', role: 'administrator' })
      const editor = await env.createAccount({ username: 'esc2-editor', role: 'editor' })
      const author = await env.createAccount({ username: 'esc2-author', role: 'author' })
      const body = await assigned(client, [admin.id, editor.id, author.id], 'subscriber')
      expect(body).toEqual({
        changed: [author.id],
        unchanged: [],
        skipped: [
          { id: admin.id, reason: 'forbidden_user' },
          { id: editor.id, reason: 'forbidden_user' },
        ],
      })
      expect(await rolesOf(admin.id)).toEqual(['administrator'])
      expect(await rolesOf(editor.id)).toEqual(['editor'])
    })

    it('rule 4: an account with two roles is judged by all of them', async () => {
      const { client } = await signedIn('esc3-manager', ['people-manager'])
      const mixed = await env.createAccount({ username: 'esc3-mixed', role: ['subscriber', 'editor'] })
      expect(await assigned(client, [mixed.id], 'subscriber')).toMatchObject({
        skipped: [{ id: mixed.id, reason: 'forbidden_user' }],
      })
    })

    it('rule 4: a caller without promote_users at all gets 403, and so does the editor', async () => {
      const { client } = await signedIn('esc4-editor', ['editor'])
      const target = await env.createAccount({ username: 'esc4-target', role: 'subscriber' })
      expect((await assign(client, [target.id], 'author')).status).toBe(403)
      expect(await rolesOf(target.id)).toEqual(['subscriber'])
      expect((await assign(env.client(), [target.id], 'author')).status).toBe(401)
    })

    it('rule 5: an account that already has exactly that role is reported as unchanged and not written', async () => {
      const { client } = await signedIn('same', ['administrator'])
      const sub = await env.createAccount({ username: 'same-sub', role: 'subscriber' })
      const multi = await env.createAccount({ username: 'same-multi', role: ['subscriber', 'author'] })
      const body = await assigned(client, [sub.id, multi.id], 'subscriber')
      expect(body).toEqual({ changed: [multi.id], unchanged: [sub.id], skipped: [] })
      const entries = await env.query<{ object_id: string }>(
        `select object_id from audit_log where action = 'user.role_changed' and object_id = any($1)`,
        [[sub.id, multi.id]],
      )
      expect(entries.map((entry) => entry.object_id)).toEqual([multi.id])
    })

    it('rule 6: one audit entry per changed account, with old and new roles, actor, address and request id', async () => {
      const { client, account } = await signedIn('audited', ['administrator'])
      const a = await env.createAccount({ username: 'audited-a', role: 'subscriber' })
      const b = await env.createAccount({ username: 'audited-b', role: ['editor', 'author'] })
      const nobody = '0198a3c2-0000-7000-8000-0000000000bb'
      await assigned(client, [a.id, b.id, nobody, account.id], 'contributor')
      const rows = await env.query<{
        actor: string
        actor_type: string
        account_id: string
        object_type: string
        object_id: string
        old_value: unknown
        new_value: unknown
        correlation_id: string | null
        ip: string | null
        source: string
      }>(
        `select actor, actor_type, account_id, object_type, object_id, old_value, new_value, correlation_id, host(ip) as ip, source
         from audit_log where action = 'user.role_changed' and (object_id = any($1)) order by object_id`,
        [[a.id, b.id, nobody, account.id]],
      )
      expect(rows).toHaveLength(2)
      const byObject = new Map(rows.map((row) => [row.object_id, row]))
      expect(byObject.get(a.id)).toMatchObject({
        actor: account.username,
        actor_type: 'account',
        account_id: account.id,
        object_type: 'account',
        old_value: { roles: ['subscriber'] },
        new_value: { roles: ['contributor'] },
        source: 'api',
      })
      expect(byObject.get(b.id)?.old_value).toEqual({ roles: ['author', 'editor'] })
      expect(byObject.get(a.id)?.ip).toMatch(/^203\.0\.113\./)
      expect(byObject.get(a.id)?.correlation_id).not.toBeNull()
    })

    it('rule 6: the audit entries and the changes are one transaction', async () => {
      const { client } = await signedIn('atomic', ['administrator'])
      const a = await env.createAccount({ username: 'atomic-a', role: 'subscriber' })
      const b = await env.createAccount({ username: 'atomic-b', role: 'subscriber' })
      await env.query(
        `create function fail_audit_for_test() returns trigger language plpgsql as
         $$ begin if new.object_id = '${b.id}' then raise exception 'audit refused'; end if; return new; end $$`,
      )
      await env.query(
        `create trigger fail_audit_for_test before insert on audit_log for each row execute function fail_audit_for_test()`,
      )
      try {
        const res = await assign(client, [a.id, b.id], 'author')
        expect(res.status).toBe(500)
      } finally {
        await env.query('drop trigger fail_audit_for_test on audit_log')
        await env.query('drop function fail_audit_for_test()')
      }
      // The first account's change was rolled back with the second's failed audit entry.
      expect(await rolesOf(a.id)).toEqual(['subscriber'])
      expect(await rolesOf(b.id)).toEqual(['subscriber'])
    })

    it('rule 7: a demoted administrator loses the capability on the open session at once, a promoted one gains it', async () => {
      const { client: actor } = await signedIn('sess-actor', ['administrator'])
      const { client: victim, account } = await signedIn('sess-victim', ['administrator'])
      const menu = async () => {
        const res = await victim.get('/api/v1/admin/menu')
        return (await res.json()) as { items: { id: string }[] }
      }
      expect((await victim.get('/api/v1/users')).status).toBe(200)
      expect((await menu()).items.map((item) => item.id)).toContain('users')
      expect(await assigned(actor, [account.id], 'subscriber')).toMatchObject({ changed: [account.id] })
      expect((await victim.get('/api/v1/users')).status).toBe(403)
      expect((await victim.put('/api/v1/users/roles', { userIds: [account.id], role: 'editor' })).status).toBe(403)
      expect((await menu()).items.map((item) => item.id)).not.toContain('users')
      // The session itself is still alive: it is the capabilities that moved.
      expect((await victim.get('/api/v1/me')).status).toBe(200)
      expect(await assigned(actor, [account.id], 'administrator')).toMatchObject({ changed: [account.id] })
      expect((await victim.get('/api/v1/users')).status).toBe(200)
    })

    it('rule 8: a role change sends no mail', async () => {
      const { client } = await signedIn('nomail', ['administrator'])
      const target = await env.createAccount({ username: 'nomail-target', role: 'subscriber' })
      const before = env.mail.sent.length
      await assigned(client, [target.id], 'editor')
      expect(env.mail.sent.length).toBe(before)
    })

    it('needs the CSRF token and a JSON body', async () => {
      const { client } = await signedIn('csrf', ['administrator'])
      const target = await env.createAccount({ username: 'csrf-target', role: 'subscriber' })
      const body = { userIds: [target.id], role: 'editor' }
      expect((await client.put('/api/v1/users/roles', body, { csrf: 'none' })).status).toBe(403)
      expect((await client.put('/api/v1/users/roles', body, { csrf: 'wrong-token' })).status).toBe(403)
      expect((await client.put('/api/v1/users/roles', body, { origin: 'https://evil.example' })).status).toBe(400)
      expect(
        (await client.request('PUT', '/api/v1/users/roles', { body: JSON.stringify(body), contentType: 'text/plain' }))
          .status,
      ).toBe(400)
      expect(await rolesOf(target.id)).toEqual(['subscriber'])
    })
  })
})
