// Registration (K-005): only when the setting is on, the default role and never an administrator, a pending account until the
// link is used, and an answer that does not depend on whether the username or the address is taken (K-004).
import { AuthOptionsResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { errorCode, mailsTo, setSetting, tokenOf, unique } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('register')

const GOOD_PASSWORD = 'a registered passphrase 77'

interface AccountRow {
  id: string
  username: string
  email: string
  status: string
  password_hash: string | null
  nicename: string
}

describe.skipIf(TEST_DATABASE_URL === undefined)('registration (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let ipCounter = 0
  const ip = () => `198.19.0.${String((ipCounter += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  const register = (username: string, email: string, address = ip()) =>
    env.client({ ip: address }).post('/api/v1/auth/register', { username, email })

  const accountsNamed = (username: string) =>
    env.query<AccountRow>(
      'select id, username, email, status, password_hash, nicename from account where lower(username) = lower($1)',
      [username],
    )

  const rolesOf = (accountId: string) =>
    env.query<{ slug: string }>(
      'select r.slug from account_role ar join role r on r.id = ar.role_id where ar.account_id = $1 order by r.slug',
      [accountId],
    )

  async function withRegistration<T>(work: () => Promise<T>): Promise<T> {
    await setSetting(env, 'users_can_register', true)
    try {
      return await work()
    } finally {
      await setSetting(env, 'users_can_register', false)
    }
  }

  describe('when it is off (the default)', () => {
    it('refuses with 403 registration_closed and makes nothing', async () => {
      const name = unique('closed')
      const res = await register(name, `${name}@example.test`)
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('registration_closed')
      expect(await accountsNamed(name)).toHaveLength(0)
      expect(mailsTo(env, `${name}@example.test`)).toHaveLength(0)
    })

    it('says so on GET /auth/options, which anyone may read', async () => {
      const res = await env.client({ ip: ip() }).get('/api/v1/auth/options')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ registrationOpen: false, siteName: '' })
      await withRegistration(async () => {
        const open = await env.client({ ip: ip() }).get('/api/v1/auth/options')
        expect(await open.json()).toEqual({ registrationOpen: true, siteName: '' })
      })
    })

    it('gives the site name from the settings (blogname), trimmed, and an empty string when it is not set', async () => {
      await setSetting(env, 'blogname', '  Bloggen min  ')
      try {
        const res = await env.client({ ip: ip() }).get('/api/v1/auth/options')
        expect(AuthOptionsResponse.parse(await res.json()).siteName).toBe('Bloggen min')
        await setSetting(env, 'blogname', '')
        const empty = await env.client({ ip: ip() }).get('/api/v1/auth/options')
        expect(AuthOptionsResponse.parse(await empty.json()).siteName).toBe('')
      } finally {
        await setSetting(env, 'blogname', '')
      }
    })
  })

  describe('when it is on', () => {
    it('makes a pending account with the default role and no password, and mails the link', async () => {
      await withRegistration(async () => {
        const name = unique('newcomer')
        const res = await register(name, `${name}@example.test`)
        expect(res.status).toBe(202)
        expect(await res.json()).toEqual({ status: 'accepted' })

        const [account] = await accountsNamed(name)
        expect(account).toMatchObject({
          username: name,
          email: `${name}@example.test`,
          status: 'pending',
          password_hash: null,
        })
        expect(await rolesOf(account?.id ?? '')).toEqual([{ slug: 'subscriber' }])
        const mails = mailsTo(env, `${name}@example.test`)
        expect(mails.map((mail) => mail.template)).toEqual(['set_password'])
        const rows = await env.query<{ purpose: string; used_at: Date | null; expires_at: Date }>(
          'select purpose, used_at, expires_at from account_token where account_id = $1',
          [account?.id],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ purpose: 'set_password', used_at: null })
        const audit = await env.query<{ action: string }>('select action from audit_log where account_id = $1', [
          account?.id,
        ])
        expect(audit.map((row) => row.action)).toEqual(['account.registered'])

        // It cannot sign in until the link is used.
        expect((await env.client({ ip: ip() }).login(name, GOOD_PASSWORD)).status).toBe(401)
        const token = tokenOf(env, 'set_password', `${name}@example.test`)
        const set = await env.client({ ip: ip() }).post('/api/v1/auth/password/set', { token, password: GOOD_PASSWORD })
        expect(set.status).toBe(204)
        expect((await accountsNamed(name))[0]?.status).toBe('active')
        expect((await env.client({ ip: ip() }).login(name, GOOD_PASSWORD)).status).toBe(200)
      })
    })

    it('uses the role the setting names', async () => {
      await withRegistration(async () => {
        await setSetting(env, 'default_role', 'contributor')
        try {
          const name = unique('contrib')
          expect((await register(name, `${name}@example.test`)).status).toBe(202)
          expect(await rolesOf((await accountsNamed(name))[0]?.id ?? '')).toEqual([{ slug: 'contributor' }])
        } finally {
          await setSetting(env, 'default_role', 'subscriber')
        }
      })
    })

    it('never gives the administrator role: a stored «administrator» is refused by the setting and falls back', async () => {
      await withRegistration(async () => {
        // Written straight to the table, past the settings schema.
        await setSetting(env, 'default_role', 'administrator')
        try {
          const name = unique('sneaky')
          expect((await register(name, `${name}@example.test`)).status).toBe(202)
          const roles = await rolesOf((await accountsNamed(name))[0]?.id ?? '')
          expect(roles).toEqual([{ slug: 'subscriber' }])
          expect(env.lines.some((line) => line['key'] === 'default_role')).toBe(true)
        } finally {
          await setSetting(env, 'default_role', 'subscriber')
        }
      })
    })

    it('refuses a default role that can run the site, and one that does not exist, with 503 and no account', async () => {
      await withRegistration(async () => {
        await env.query(
          `insert into role (slug, name, capabilities) values ('shop-manager', 'Shop manager', array['read', 'manage_options'])`,
        )
        try {
          for (const slug of ['shop-manager', 'no-such-role']) {
            await setSetting(env, 'default_role', slug)
            const name = unique('blocked')
            const res = await register(name, `${name}@example.test`)
            expect(res.status, slug).toBe(503)
            expect(await errorCode(res), slug).toBe('registration_unavailable')
            expect(await accountsNamed(name), slug).toHaveLength(0)
          }
        } finally {
          await setSetting(env, 'default_role', 'subscriber')
          await env.query(`delete from role where slug = 'shop-manager'`)
        }
      })
    })

    it('mails the administrators when the setting is on, and nobody when it is off', async () => {
      await withRegistration(async () => {
        const admin = await env.createAccount({ username: unique('registrar'), role: 'administrator' })
        await setSetting(env, 'notify_admin_new_user', true)
        const name = unique('noticed')
        expect((await register(name, `${name}@example.test`)).status).toBe(202)
        const notices = mailsTo(env, admin.email).filter((mail) => mail.template === 'admin_new_user')
        expect(notices.at(-1)?.data).toEqual({ username: name, email: `${name}@example.test` })

        await setSetting(env, 'notify_admin_new_user', false)
        try {
          const before = mailsTo(env, admin.email).length
          const quiet = unique('unnoticed')
          expect((await register(quiet, `${quiet}@example.test`)).status).toBe(202)
          expect(mailsTo(env, admin.email)).toHaveLength(before)
        } finally {
          await setSetting(env, 'notify_admin_new_user', true)
        }
      })
    })
  })

  describe('the same answer whatever exists (no enumeration)', () => {
    it('answers a free name, a taken name, a taken address and both taken with the same status and body', async () => {
      await withRegistration(async () => {
        const taken = await env.createAccount({ username: unique('taken'), email: `${unique('taken')}@example.test` })
        const fresh = unique('fresh')
        const answers = await Promise.all([
          register(fresh, `${fresh}@example.test`),
          register(taken.username, `${unique('other')}@example.test`),
          register(unique('another'), taken.email),
          register(taken.username, taken.email),
        ])
        const shapes = await Promise.all(
          answers.map(async (res) => ({
            status: res.status,
            body: await res.clone().text(),
            headers: [...res.headers.keys()].filter((key) => !['x-request-id', 'date'].includes(key)).sort(),
          })),
        )
        for (const shape of shapes) {
          expect(shape).toEqual(shapes[0])
        }
        expect(shapes[0]).toMatchObject({ status: 202, body: '{"status":"accepted"}' })
      })
    })

    it('an address that has an account gets «you already have an account», and no second account is made', async () => {
      await withRegistration(async () => {
        const owner = await env.createAccount({ username: unique('owner'), email: `${unique('owner')}@example.test` })
        const attempt = unique('imposter')
        expect((await register(attempt, owner.email.toUpperCase())).status).toBe(202)
        expect(await accountsNamed(attempt)).toHaveLength(0)
        const mails = mailsTo(env, owner.email)
        expect(mails.map((mail) => mail.template)).toEqual(['account_exists'])
        expect(mails[0]?.data).toEqual({ username: owner.username })
        // Nothing the owner could be harmed with: no token anywhere.
        expect(await env.query('select 1 from account_token where account_id = $1', [owner.id])).toHaveLength(0)
      })
    })

    it('a taken username with a new address makes nothing and sends nothing', async () => {
      await withRegistration(async () => {
        const holder = await env.createAccount({ username: unique('holder') })
        const address = `${unique('wanter')}@example.test`
        expect((await register(holder.username.toUpperCase(), address)).status).toBe(202)
        expect(mailsTo(env, address)).toHaveLength(0)
        expect(await env.query('select 1 from account where lower(email) = lower($1)', [address])).toHaveLength(0)
        expect(await accountsNamed(holder.username)).toHaveLength(1)
      })
    })

    it('an address whose account is still waiting for its password gets the welcome link again, and the old one is void', async () => {
      await withRegistration(async () => {
        const name = unique('forgetful')
        const address = `${name}@example.test`
        expect((await register(name, address)).status).toBe(202)
        const first = tokenOf(env, 'set_password', address)
        expect((await register(unique('whatever'), address)).status).toBe(202)
        const second = tokenOf(env, 'set_password', address)
        expect(second).not.toBe(first)
        expect(await accountsNamed(name)).toHaveLength(1)
        const client = env.client({ ip: ip() })
        expect((await client.post('/api/v1/auth/password/set', { token: first, password: GOOD_PASSWORD })).status).toBe(
          400,
        )
        expect(
          (await client.post('/api/v1/auth/password/set', { token: second, password: GOOD_PASSWORD })).status,
        ).toBe(204)
      })
    })

    it('leaves a disabled account alone', async () => {
      await withRegistration(async () => {
        const off = await env.createAccount({ username: unique('disabled'), status: 'disabled' })
        const res = await register(unique('hopeful'), off.email)
        expect(res.status).toBe(202)
        expect(mailsTo(env, off.email)).toHaveLength(0)
      })
    })

    it('two registrations for one name at once make one account and answer alike', async () => {
      await withRegistration(async () => {
        const name = unique('twin')
        const results = await Promise.all([
          register(name, `${name}-a@example.test`),
          register(name, `${name}-b@example.test`),
        ])
        expect(results.map((res) => res.status)).toEqual([202, 202])
        expect(await accountsNamed(name)).toHaveLength(1)
      })
    })

    it('takes about the same time for a free and a taken name', async () => {
      await withRegistration(async () => {
        const slow = env.variant({ minimumResponseMs: 300 })
        const taken = await env.createAccount({ username: unique('timed') })
        const client = slow.client({ ip: ip() })
        const time = async (username: string, email: string) => {
          const started = performance.now()
          expect((await client.post('/api/v1/auth/register', { username, email })).status).toBe(202)
          return performance.now() - started
        }
        const free: number[] = []
        const used: number[] = []
        for (let n = 0; n < 3; n += 1) {
          const name = unique('timedfree')
          free.push(await time(name, `${name}@example.test`))
          used.push(await time(taken.username, `${unique('t')}@example.test`))
        }
        const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0
        expect(Math.min(...free, ...used)).toBeGreaterThanOrEqual(290)
        expect(Math.abs(median(free) - median(used))).toBeLessThan(150)
      })
    })
  })

  describe('input and limits', () => {
    it('refuses a username or an address that cannot be used', async () => {
      await withRegistration(async () => {
        const client = env.client({ ip: ip() })
        const bad: unknown[] = [
          { username: 'ab', email: 'a@example.test' },
          { username: 'has space', email: 'a@example.test' },
          { username: '-leading', email: 'a@example.test' },
          { username: 'x'.repeat(61), email: 'a@example.test' },
          { username: 'fine-name', email: 'not-an-address' },
          { username: 'fine-name' },
          { email: 'a@example.test' },
          { username: 'fine-name', email: 'a@example.test', role: 'administrator' },
          { username: 'fine\nname', email: 'a@example.test' },
        ]
        for (const body of bad) {
          const res = await client.post('/api/v1/auth/register', body)
          expect(res.status, JSON.stringify(body)).toBe(400)
        }
      })
    })

    it('cannot ask for a role: the field is refused, not ignored', async () => {
      await withRegistration(async () => {
        const name = unique('greedy')
        const res = await env
          .client({ ip: ip() })
          .post('/api/v1/auth/register', { username: name, email: `${name}@example.test`, role: 'administrator' })
        expect(res.status).toBe(400)
        expect(await accountsNamed(name)).toHaveLength(0)
      })
    })

    it('gives names that make the same URL part their own', async () => {
      await withRegistration(async () => {
        const base = unique('slug')
        expect((await register(`${base}.x`, `${base}a@example.test`)).status).toBe(202)
        expect((await register(`${base}-x`, `${base}b@example.test`)).status).toBe(202)
        const a = (await accountsNamed(`${base}.x`))[0]
        const b = (await accountsNamed(`${base}-x`))[0]
        expect(a?.nicename).toBe(`${base}-x`)
        expect(b?.nicename).toBe(`${base}-x-2`)
      })
    })

    it('limits an address: the 21st request in a window is 429', async () => {
      await withRegistration(async () => {
        const address = ip()
        for (let n = 0; n < 20; n += 1) {
          const name = unique('flood')
          expect((await register(name, `${name}@example.test`, address)).status).toBe(202)
        }
        const name = unique('flood')
        const res = await register(name, `${name}@example.test`, address)
        expect(res.status).toBe(429)
        expect(await accountsNamed(name)).toHaveLength(0)
      })
    })

    it('limits mail to one address: the sixth request has to wait (429), for an address with an account and one without', async () => {
      await withRegistration(async () => {
        const owner = await env.createAccount({
          username: unique('spammed'),
          email: `${unique('spammed')}@example.test`,
        })
        const nobody = `${unique('nobody')}@example.test`
        const statuses: string[] = []
        for (let n = 0; n < 7; n += 1) {
          const known = await register(unique('spammer'), owner.email)
          const unknown = await register(unique('spammer'), nobody)
          expect(known.status).toBe(unknown.status)
          expect(known.headers.get('retry-after')).toBe(unknown.headers.get('retry-after'))
          statuses.push(`${String(known.status)} ${known.headers.get('retry-after') ?? '-'}`)
        }
        expect(statuses).toEqual(['202 -', '202 -', '202 -', '202 -', '202 -', '429 30', '429 30'])
        expect(mailsTo(env, owner.email)).toHaveLength(5)
      })
    })

    it('needs a JSON body from our own origin', async () => {
      await withRegistration(async () => {
        const client = env.client({ ip: ip() })
        const body = { username: unique('csrf'), email: 'csrf@example.test' }
        expect((await client.post('/api/v1/auth/register', body, { origin: 'https://evil.example' })).status).toBe(400)
        expect((await client.post('/api/v1/auth/register', body, { origin: null })).status).toBe(400)
      })
    })

    it('puts no address in the log', async () => {
      await withRegistration(async () => {
        const name = unique('private')
        await register(name, `${name}@example.test`)
      })
      expect(JSON.stringify(env.lines)).not.toContain('@example.test')
      expect(TEST_PASSWORD).toBeTruthy()
    })
  })
})
