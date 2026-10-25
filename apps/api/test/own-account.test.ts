// The signed-in person's password (K-013) and e-mail address (K-012). Both ask for the current password; a new address is
// confirmed by a link sent to it.
import { createHash } from 'node:crypto'

import { EmailChangeConfirmResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { errorCode, mailsTo, setSetting, tokenOf, unique } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('own-account')

const HOUR = 60 * 60 * 1000
const NEW_PASSWORD = 'my second passphrase 55'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

describe.skipIf(TEST_DATABASE_URL === undefined)(
  'password and e-mail of the signed-in account (needs TEST_DATABASE_URL)',
  () => {
    let env: AuthTestApp
    let ipCounter = 0
    const ip = () => `198.51.100.${String((ipCounter += 1))}`

    beforeAll(async () => {
      env = await startAuthApp()
    })
    afterAll(async () => {
      await env.close()
    })

    async function signedIn(base: string, role: 'subscriber' | 'administrator' = 'subscriber') {
      const account = await env.createAccount({ username: unique(base), role })
      const client = env.client({ ip: ip() })
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      return { account, client }
    }

    const newAddress = () => `${unique('new')}@example.test`

    describe('PATCH /me/password', () => {
      it('changes the password, keeps this session and signs out the others', async () => {
        const { account, client } = await signedIn('chpw')
        const other = env.client({ ip: ip() })
        await other.login(account.username, TEST_PASSWORD)

        const res = await client.patch('/api/v1/me/password', {
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        expect(res.status).toBe(204)
        expect(res.headers.get('cache-control')).toBe('no-store')

        expect((await client.get('/api/v1/me')).status).toBe(200)
        expect((await other.get('/api/v1/me')).status).toBe(401)
        expect((await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)).status).toBe(401)
        expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(200)
        const [row] = await env.query<{ password_hash: string }>('select password_hash from account where id = $1', [
          account.id,
        ])
        expect(row?.password_hash).toMatch(/^\$argon2id\$/)
        const audit = await env.query<{ action: string; new_value: { otherSessionsRevoked: number } }>(
          `select action, new_value from audit_log where account_id = $1 and action = 'password.changed'`,
          [account.id],
        )
        expect(audit).toHaveLength(1)
        expect(audit[0]?.new_value.otherSessionsRevoked).toBe(1)
      })

      it('needs the current password (none is 400), and tells the owner before the change, only when it goes through', async () => {
        const { account, client } = await signedIn('chpw-notice')
        const notices = () => mailsTo(env, account.email).filter((mail) => mail.template === 'security_notice')
        const none = await client.patch('/api/v1/me/password', { newPassword: NEW_PASSWORD })
        expect(none.status).toBe(400)
        expect(
          (await client.patch('/api/v1/me/password', { currentPassword: 'wrong', newPassword: NEW_PASSWORD })).status,
        ).toBe(403)
        // A new password the site refuses is no change either.
        expect(
          (await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: account.username }))
            .status,
        ).toBe(400)
        expect(notices()).toHaveLength(0)

        expect(
          (await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }))
            .status,
        ).toBe(204)
        expect(notices().map((mail) => mail.data)).toEqual([{ username: account.username, action: 'password_changed' }])
      })

      it('needs the current password: a wrong one is 403 invalid_password and changes nothing', async () => {
        const { account, client } = await signedIn('chpw-wrong')
        const res = await client.patch('/api/v1/me/password', {
          currentPassword: 'not it at all',
          newPassword: NEW_PASSWORD,
        })
        expect(res.status).toBe(403)
        expect(await errorCode(res)).toBe('invalid_password')
        expect((await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)).status).toBe(200)
      })

      it('counts wrong passwords like a failed login: five and then 429, even for the right one', async () => {
        const { account, client } = await signedIn('chpw-limit')
        for (let n = 0; n < 5; n += 1) {
          expect(
            (
              await client.patch('/api/v1/me/password', {
                currentPassword: `wrong ${String(n)}`,
                newPassword: NEW_PASSWORD,
              })
            ).status,
          ).toBe(403)
        }
        const locked = await client.patch('/api/v1/me/password', {
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        expect(locked.status).toBe(429)
        expect(locked.headers.get('retry-after')).toBe('30')
        // The password did not change. The login of the same name waits too: the failures are counted together.
        expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(429)
        env.clock.advance(31_000)
        expect((await env.client({ ip: ip() }).login(account.username, NEW_PASSWORD)).status).toBe(401)
      })

      it('refuses a short password, the username and the address; unknown fields too', async () => {
        const account = await env.createAccount({
          username: unique('chpwuser'),
          email: `${unique('chpw')}@example.test`,
        })
        const client = env.client({ ip: ip() })
        await client.login(account.username, TEST_PASSWORD)
        expect(
          (await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: 'short' })).status,
        ).toBe(400)
        for (const same of [account.username, account.email]) {
          const res = await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: same })
          expect(res.status).toBe(400)
          expect(await errorCode(res)).toBe('weak_password')
        }
        expect(
          (
            await client.patch('/api/v1/me/password', {
              currentPassword: TEST_PASSWORD,
              newPassword: NEW_PASSWORD,
              email: 'x@y.test',
            })
          ).status,
        ).toBe(400)
      })

      it('needs the CSRF token and a signed-in session', async () => {
        const { client } = await signedIn('chpw-csrf')
        expect(
          (
            await client.patch(
              '/api/v1/me/password',
              { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
              { csrf: 'none' },
            )
          ).status,
        ).toBe(403)
        const anonymous = env.client({ ip: ip() })
        expect(
          (
            await anonymous.patch(
              '/api/v1/me/password',
              { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
              { csrf: 'none' },
            )
          ).status,
        ).toBe(401)
      })

      it("voids the account's pending links, and mails the administrators (not about their own change)", async () => {
        const admin = await env.createAccount({ username: unique('watching'), role: 'administrator' })
        const { account, client } = await signedIn('chpw-links')
        await setSetting(env, 'notify_admin_password_change', true)
        expect(
          (await client.post('/api/v1/me/email-change', { newEmail: newAddress(), password: TEST_PASSWORD })).status,
        ).toBe(202)
        expect(
          await env.query('select 1 from account_token where account_id = $1 and used_at is null', [account.id]),
        ).toHaveLength(1)

        expect(
          (await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }))
            .status,
        ).toBe(204)
        expect(
          await env.query('select 1 from account_token where account_id = $1 and used_at is null', [account.id]),
        ).toHaveLength(0)
        const notices = mailsTo(env, admin.email).filter((mail) => mail.template === 'admin_password_change')
        expect(notices.at(-1)?.data).toEqual({ username: account.username })

        // An administrator changing their own password gets no administrators' notice about it (only the owner's own security notice).
        const own = await signedIn('chpw-admin', 'administrator')
        expect(
          (await own.client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }))
            .status,
        ).toBe(204)
        expect(mailsTo(env, own.account.email).map((mail) => mail.template)).toEqual(['security_notice'])
      })

      it('does not mail the administrators when the setting is off', async () => {
        const admin = await env.createAccount({ username: unique('unwatching'), role: 'administrator' })
        const { client } = await signedIn('chpw-quiet')
        await setSetting(env, 'notify_admin_password_change', false)
        try {
          const before = mailsTo(env, admin.email).length
          expect(
            (await client.patch('/api/v1/me/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }))
              .status,
          ).toBe(204)
          expect(mailsTo(env, admin.email)).toHaveLength(before)
        } finally {
          await setSetting(env, 'notify_admin_password_change', true)
        }
      })

      it('logs no password', async () => {
        const { client } = await signedIn('chpw-log')
        await client.patch('/api/v1/me/password', {
          currentPassword: TEST_PASSWORD,
          newPassword: 'a secret that must not be logged 1',
        })
        expect(JSON.stringify(env.lines)).not.toContain('a secret that must not be logged')
      })
    })

    describe('POST /me/email-change', () => {
      async function requested(client: TestClient, to = newAddress()) {
        const res = await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        expect(res.status).toBe(202)
        return to
      }

      it('mails the link to the NEW address and a notice to the old one, and changes nothing yet', async () => {
        const { account, client } = await signedIn('email')
        const to = newAddress()
        const before = env.clock.now().getTime()
        const res = await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        expect(res.status).toBe(202)
        expect(await res.json()).toEqual({ status: 'accepted' })

        const toNew = mailsTo(env, to)
        expect(toNew.map((mail) => mail.template)).toEqual(['email_change'])
        const toOld = mailsTo(env, account.email)
        expect(toOld.map((mail) => mail.template)).toEqual(['email_change_notice'])
        expect(toOld[0]?.data).toEqual({ username: account.username, newEmail: to })
        // The old address is not given the link.
        expect(JSON.stringify(toOld)).not.toContain(tokenOf(env, 'email_change', to))

        const [row] = await env.query<{
          purpose: string
          token_hash: string
          new_email: string
          expires_at: Date
          used_at: Date | null
        }>('select purpose, token_hash, new_email, expires_at, used_at from account_token where account_id = $1', [
          account.id,
        ])
        expect(row).toMatchObject({ purpose: 'email_change', new_email: to, used_at: null })
        expect(row?.token_hash).toBe(sha256(tokenOf(env, 'email_change', to)))
        expect((row?.expires_at.getTime() ?? 0) - before).toBeGreaterThan(24 * HOUR - 5000)
        expect(
          (await env.query<{ email: string }>('select email from account where id = $1', [account.id]))[0]?.email,
        ).toBe(account.email)
      })

      it('needs the current password: none is 400, a wrong one 403, and the old address is told with the right one', async () => {
        const { account, client } = await signedIn('email-pw')
        const to = newAddress()
        const none = await client.post('/api/v1/me/email-change', { newEmail: to })
        expect(none.status).toBe(400)
        const res = await client.post('/api/v1/me/email-change', { newEmail: to, password: 'nope, not this' })
        expect(res.status).toBe(403)
        expect(await errorCode(res)).toBe('invalid_password')
        expect(mailsTo(env, to)).toHaveLength(0)
        expect(mailsTo(env, account.email)).toHaveLength(0)

        expect((await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })).status).toBe(
          202,
        )
        expect(mailsTo(env, account.email).map((mail) => mail.template)).toEqual(['email_change_notice'])
      })

      it('refuses the address the account has already, and a malformed one', async () => {
        const { account, client } = await signedIn('email-same')
        const same = await client.post('/api/v1/me/email-change', {
          newEmail: account.email.toUpperCase(),
          password: TEST_PASSWORD,
        })
        expect(same.status).toBe(400)
        expect(await errorCode(same)).toBe('same_email')
        expect(
          (await client.post('/api/v1/me/email-change', { newEmail: 'nonsense', password: TEST_PASSWORD })).status,
        ).toBe(400)
      })

      it('answers the same when the address belongs to someone else, and tells that someone by mail', async () => {
        const { client } = await signedIn('email-taken')
        const owner = await env.createAccount({ username: unique('keeper'), email: `${unique('keeper')}@example.test` })
        const free = newAddress()
        const taken = await client.post('/api/v1/me/email-change', { newEmail: owner.email, password: TEST_PASSWORD })
        const fresh = await client.post('/api/v1/me/email-change', { newEmail: free, password: TEST_PASSWORD })
        expect(taken.status).toBe(fresh.status)
        expect(await taken.text()).toBe(await fresh.text())
        expect(mailsTo(env, owner.email).map((mail) => mail.template)).toEqual(['account_exists'])
      })

      it('stores, audits and announces a request for a taken address like one for a free address, but sends no link', async () => {
        const { client, account } = await signedIn('email-taken-same')
        const owner = await env.createAccount({ username: unique('keeper'), email: `${unique('keeper')}@example.test` })
        const free = newAddress()
        expect((await client.post('/api/v1/me/email-change', { newEmail: free, password: TEST_PASSWORD })).status).toBe(
          202,
        )
        expect(
          (await client.post('/api/v1/me/email-change', { newEmail: owner.email, password: TEST_PASSWORD })).status,
        ).toBe(202)
        // The earlier link is voided as by any new request, and the pending request names the taken address.
        expect(
          await env.query(
            "select new_email from account_token where account_id = $1 and purpose = 'email_change' and used_at is null",
            [account.id],
          ),
        ).toEqual([{ new_email: owner.email }])
        expect(
          await env.query("select 1 from audit_log where account_id = $1 and action = 'email_change.requested'", [
            account.id,
          ]),
        ).toHaveLength(2)
        expect(mailsTo(env, account.email).map((mail) => mail.template)).toEqual([
          'email_change_notice',
          'email_change_notice',
        ])
        expect(mailsTo(env, owner.email).map((mail) => mail.template)).toEqual(['account_exists'])
        expect(mailsTo(env, free).map((mail) => mail.template)).toEqual(['email_change'])
      })

      it('a new request voids the earlier link', async () => {
        const { client } = await signedIn('email-twice')
        const first = await requested(client)
        const second = await requested(client)
        const firstToken = tokenOf(env, 'email_change', first)
        const secondToken = tokenOf(env, 'email_change', second)
        expect((await client.post('/api/v1/me/email-change/confirm', { token: firstToken })).status).toBe(400)
        expect((await client.post('/api/v1/me/email-change/confirm', { token: secondToken })).status).toBe(200)
      })

      it('takes about the same time for a free address and a taken one', async () => {
        const slow = env.variant({ minimumResponseMs: 300 })
        const account = await env.createAccount({ username: unique('timing-mail') })
        const client = slow.client({ ip: ip() })
        await client.login(account.username, TEST_PASSWORD)
        const owner = await env.createAccount({
          username: unique('timing-owner'),
          email: `${unique('timing')}@example.test`,
        })
        const time = async (newEmail: string) => {
          const started = performance.now()
          expect((await client.post('/api/v1/me/email-change', { newEmail, password: TEST_PASSWORD })).status).toBe(202)
          return performance.now() - started
        }
        const free: number[] = []
        const used: number[] = []
        for (let n = 0; n < 3; n += 1) {
          free.push(await time(newAddress()))
          used.push(await time(owner.email))
        }
        const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0
        expect(Math.min(...free, ...used)).toBeGreaterThanOrEqual(290)
        expect(Math.abs(median(free) - median(used))).toBeLessThan(150)
      })

      it('counts wrong passwords like a failed login', async () => {
        const { client } = await signedIn('email-limit')
        for (let n = 0; n < 5; n += 1) {
          expect(
            (await client.post('/api/v1/me/email-change', { newEmail: newAddress(), password: `wrong ${String(n)}` }))
              .status,
          ).toBe(403)
        }
        expect(
          (await client.post('/api/v1/me/email-change', { newEmail: newAddress(), password: TEST_PASSWORD })).status,
        ).toBe(429)
      })
    })

    describe('POST /me/email-change/confirm', () => {
      it('switches the address, uses the link up, and the new address logs in', async () => {
        const { account, client } = await signedIn('confirm')
        const to = newAddress()
        await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        const token = tokenOf(env, 'email_change', to)

        const res = await client.post('/api/v1/me/email-change/confirm', { token })
        expect(res.status).toBe(200)
        expect(EmailChangeConfirmResponse.parse(await res.json())).toEqual({ email: to })
        expect(((await (await client.get('/api/v1/me')).json()) as { email: string }).email).toBe(to)
        expect(
          (await env.query<{ email: string }>('select email from account where id = $1', [account.id]))[0]?.email,
        ).toBe(to)
        expect((await env.client({ ip: ip() }).login(to, TEST_PASSWORD)).status).toBe(200)
        expect((await env.client({ ip: ip() }).login(account.email, TEST_PASSWORD)).status).toBe(401)
        const audit = await env.query<{ action: string }>(
          `select action from audit_log where account_id = $1 order by created_at`,
          [account.id],
        )
        expect(audit.map((row) => row.action)).toEqual(
          expect.arrayContaining(['email_change.requested', 'email_change.confirmed']),
        )

        // Used.
        const again = await client.post('/api/v1/me/email-change/confirm', { token })
        expect(again.status).toBe(400)
        expect(await errorCode(again)).toBe('invalid_token')
      })

      it('stops working after 24 hours', async () => {
        const { account, client } = await signedIn('confirm-late')
        const to = newAddress()
        await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        const token = tokenOf(env, 'email_change', to)
        env.clock.advance(24 * HOUR + 60_000)
        // The session lived 2 days, so it is still there.
        const res = await client.post('/api/v1/me/email-change/confirm', { token })
        expect(res.status).toBe(400)
        expect(await errorCode(res)).toBe('invalid_token')
        expect(
          (await env.query<{ email: string }>('select email from account where id = $1', [account.id]))[0]?.email,
        ).toBe(account.email)
      })

      it('only works for the account the link was made for', async () => {
        const mine = await signedIn('confirm-mine')
        const other = await signedIn('confirm-other')
        const to = newAddress()
        await mine.client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        const token = tokenOf(env, 'email_change', to)
        const res = await other.client.post('/api/v1/me/email-change/confirm', { token })
        expect(res.status).toBe(400)
        expect(await errorCode(res)).toBe('invalid_token')
        expect(
          (await env.query<{ email: string }>('select email from account where id = $1', [other.account.id]))[0]?.email,
        ).toBe(other.account.email)
        // The link is still good for its own account.
        expect((await mine.client.post('/api/v1/me/email-change/confirm', { token })).status).toBe(200)
      })

      it('needs a session: the link alone does nothing', async () => {
        const { client } = await signedIn('confirm-anon')
        const to = newAddress()
        await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        const token = tokenOf(env, 'email_change', to)
        const anonymous = env.client({ ip: ip() })
        expect((await anonymous.post('/api/v1/me/email-change/confirm', { token }, { csrf: 'none' })).status).toBe(401)
        expect((await client.post('/api/v1/me/email-change/confirm', { token }, { csrf: 'none' })).status).toBe(403)
      })

      it('refuses a link for another purpose, an unknown token and a malformed one', async () => {
        const { account, client } = await signedIn('confirm-wrong')
        expect(
          (await env.client({ ip: ip() }).post('/api/v1/auth/password/lost', { login: account.username })).status,
        ).toBe(202)
        const resetToken = tokenOf(env, 'password_reset', account.email)
        const wrongPurpose = await client.post('/api/v1/me/email-change/confirm', { token: resetToken })
        expect(wrongPurpose.status).toBe(400)
        expect(await errorCode(wrongPurpose)).toBe('invalid_token')
        expect((await client.post('/api/v1/me/email-change/confirm', { token: 'q'.repeat(43) })).status).toBe(400)
        const malformed = await client.post('/api/v1/me/email-change/confirm', { token: 'short' })
        expect(malformed.status).toBe(400)
        expect(await errorCode(malformed)).toBe('validation_error')
        // The reset link was not used up.
        expect(
          await env.query(
            `select 1 from account_token where account_id = $1 and purpose = 'password_reset' and used_at is null`,
            [account.id],
          ),
        ).toHaveLength(1)
      })

      it('does not switch to an address someone has taken in the meantime', async () => {
        const { account, client } = await signedIn('confirm-race')
        const to = newAddress()
        await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        const token = tokenOf(env, 'email_change', to)
        await env.createAccount({ username: unique('quick'), email: to.toUpperCase() })
        const res = await client.post('/api/v1/me/email-change/confirm', { token })
        expect(res.status).toBe(409)
        expect(await errorCode(res)).toBe('email_unavailable')
        expect(
          (await env.query<{ email: string }>('select email from account where id = $1', [account.id]))[0]?.email,
        ).toBe(account.email)
      })

      it('a reset of the password voids the link, and a switch voids the other links', async () => {
        const { account, client } = await signedIn('confirm-void')
        const to = newAddress()
        await client.post('/api/v1/me/email-change', { newEmail: to, password: TEST_PASSWORD })
        await env.client({ ip: ip() }).post('/api/v1/auth/password/lost', { login: account.username })
        const emailToken = tokenOf(env, 'email_change', to)
        const resetToken = tokenOf(env, 'password_reset', account.email)
        expect((await client.post('/api/v1/me/email-change/confirm', { token: emailToken })).status).toBe(200)
        // The reset link went to the old address; the switch voided it.
        const reset = await env
          .client({ ip: ip() })
          .post('/api/v1/auth/password/reset', { token: resetToken, password: NEW_PASSWORD })
        expect(reset.status).toBe(400)
      })
    })
  },
)
