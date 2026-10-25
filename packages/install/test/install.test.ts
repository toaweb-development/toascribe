// The install service against a real PostgreSQL 18 (typescript §6), as the app role: the setup token, the wizard's saved
// steps, the system check, the test mail, the recovery key, and the install transaction with its concurrency and rollback.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WEAK_PASSWORD_MESSAGE, hashToken, verifyPassword } from '@toascribe/auth'
import { DefaultContentExistsError, readMigrationJournal, seedDefaultContent } from '@toascribe/db'
import { CoreSettings, SETUP_EMAIL_SKIPPED_NOTICE, SMTP_PASSWORD_AAD } from '@toascribe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { AlreadyInstalledError, InstallError } from '../src/errors.ts'
import { generateRecoveryKey, recoveryKeyVerifier } from '../src/recovery-key.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { SITE, SMTP, TEST_ORIGIN, admin, resetInstall, startInstallEnv, stubMail, testKeyRing } from './harness.ts'
import type { InstallEnv } from './harness.ts'

noticeIfSkipped('install')

/** Runs the steps the wizard runs before the last act, with the e-mail step skipped. */
async function prepare(env: InstallEnv): Promise<string> {
  await env.service.saveSite(SITE)
  await env.service.skipEmail()
  return env.service.generateRecoveryKey()
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected the promise to reject')
}

describe.skipIf(TEST_DATABASE_URL === undefined)('the install service (needs TEST_DATABASE_URL)', () => {
  let env: InstallEnv

  beforeAll(async () => {
    env = await startInstallEnv()
  })

  afterAll(async () => {
    await env.close()
  })

  beforeEach(async () => {
    await resetInstall(env)
  })

  describe('the setup token', () => {
    it('is stored as a hash only, and verifies', async () => {
      const token = await env.service.issueSetupToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const rows = await env.query<{ secret_hash: string }>(
        `select secret_hash from site_secret where purpose = 'setup_token'`,
      )
      expect(rows).toEqual([{ secret_hash: hashToken(token) }])
      // The token itself is nowhere in the database.
      const dump = await env.query<{ found: boolean }>(
        `select exists (select 1 from site_secret where secret_hash = $1 or secret_hash like '%' || $1 || '%') as found`,
        [token],
      )
      expect(dump[0]?.found).toBe(false)
      expect(await env.service.verifySetupToken(token)).toBe(true)
    })

    it('is long enough: 256 bits, and a new one every time', async () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 20; i += 1) {
        tokens.add(await env.service.issueSetupToken())
      }
      expect(tokens.size).toBe(20)
      const token = [...tokens][0] ?? ''
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    })

    it('is replaced by the next one: the old one stops working', async () => {
      const first = await env.service.issueSetupToken()
      const second = await env.service.issueSetupToken()
      expect(await env.service.verifySetupToken(first)).toBe(false)
      expect(await env.service.verifySetupToken(second)).toBe(true)
      expect(await env.query(`select 1 from site_secret where purpose = 'setup_token'`)).toHaveLength(1)
    })

    it('does not verify a wrong token, a token of the wrong shape, or any token when none is stored', async () => {
      expect(await env.service.verifySetupToken('A'.repeat(43))).toBe(false)
      const token = await env.service.issueSetupToken()
      expect(await env.service.verifySetupToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`)).toBe(false)
      expect(await env.service.verifySetupToken('')).toBe(false)
      expect(await env.service.verifySetupToken(`${token}${token}${token}`)).toBe(false)
      expect(await env.service.verifySetupToken('x y')).toBe(false)
      expect(await env.service.verifySetupToken('💥'.repeat(20))).toBe(false)
    })

    it('is not made for an installed site, and an installed site verifies nothing', async () => {
      const token = await env.service.issueSetupToken()
      const key = await prepare(env)
      await env.service.install({ admin: admin(), recovery: { key, confirmed: true } })
      expect(await env.service.verifySetupToken(token)).toBe(false)
      expect(await failure(env.service.issueSetupToken())).toBeInstanceOf(AlreadyInstalledError)
    })
  })

  describe('the saved steps', () => {
    it('starts at the system check and moves on as each step is saved', async () => {
      expect(await env.service.status()).toEqual({ installed: false, nextStep: 'check' })
      expect(await env.service.state()).toEqual({ nextStep: 'check', site: null, email: null, emailSkipped: false })

      expect(await env.service.saveSite(SITE)).toEqual(SITE)
      expect(await env.service.status()).toEqual({ installed: false, nextStep: 'email' })

      await env.service.skipEmail()
      expect(await env.service.status()).toEqual({ installed: false, nextStep: 'admin' })
      expect(await env.service.state()).toEqual({ nextStep: 'admin', site: SITE, email: null, emailSkipped: true })
    })

    it('saves the site step as plain settings', async () => {
      await env.service.saveSite({ ...SITE, title: '  Min blogg  ', blogPublic: false })
      expect(await env.setting('blogname')).toBe('Min blogg')
      expect(await env.setting('locale')).toBe('nb')
      expect(await env.setting('timezone_string')).toBe('Europe/Oslo')
      expect(await env.setting('admin_email')).toBe('ansvarlig@example.test')
      expect(await env.setting('blog_public')).toBe(false)
      expect((await env.service.state()).site).toEqual({ ...SITE, title: 'Min blogg', blogPublic: false })
    })

    it('refuses a site step that does not pass its schema, naming fields and never values', async () => {
      for (const bad of [
        { ...SITE, timezone: 'Mars/Olympus' },
        { ...SITE, timezone: '' },
        { ...SITE, title: '   ' },
        { ...SITE, title: 'two\nlines' },
        { ...SITE, locale: 'norwegian' },
        { ...SITE, adminEmail: 'not an address' },
        { ...SITE, extra: true },
      ]) {
        const err = await failure(env.service.saveSite(bad))
        expect(err).toBeInstanceOf(InstallError)
        expect((err as InstallError).code).toBe('invalid_input')
      }
      expect(await env.setting('blogname')).toBe('')
    })

    it('encrypts the SMTP password with the site key and the setting identity, and never returns it', async () => {
      const saved = await env.service.saveEmail(SMTP)
      expect(saved).toEqual({
        host: 'smtp.example.test',
        port: 587,
        secure: 'starttls',
        username: 'mailer',
        smtpPasswordSet: true,
        fromAddress: 'noreply@cms.example.test',
        fromName: null,
      })
      expect(JSON.stringify(saved)).not.toContain(SMTP.password)
      expect(JSON.stringify(await env.service.state())).not.toContain(SMTP.password)

      const stored = await env.setting('smtp_password')
      expect(typeof stored).toBe('string')
      expect(stored).toMatch(/^v1:/)
      expect(String(stored)).not.toContain(SMTP.password)
      // It decrypts with the setting's identity (what the worker does) and with no other.
      expect(await testKeyRing.decrypt(String(stored), SMTP_PASSWORD_AAD)).toBe(SMTP.password)
      await expect(testKeyRing.decrypt(String(stored), 'setting:something_else')).rejects.toThrow()
      // And it is nowhere else in the database.
      const leaks = await env.query<{ n: string }>(`select count(*) as n from setting where value::text like $1`, [
        `%${SMTP.password}%`,
      ])
      expect(leaks[0]?.n).toBe('0')
    })

    it('keeps the stored password when none is sent, and removes it for an empty one', async () => {
      await env.service.saveEmail(SMTP)
      const before = await env.setting('smtp_password')
      const kept = await env.service.saveEmail({
        host: SMTP.host,
        secure: SMTP.secure,
        username: SMTP.username,
        fromAddress: SMTP.fromAddress,
        port: 2525,
      })
      expect(kept.smtpPasswordSet).toBe(true)
      expect(kept.port).toBe(2525)
      expect(await env.setting('smtp_password')).toBe(before)

      const cleared = await env.service.saveEmail({ ...SMTP, password: '' })
      expect(cleared.smtpPasswordSet).toBe(false)
      expect(await env.setting('smtp_password')).toBeNull()
    })

    it('takes the port from the encryption when none is given, and drops the password when there is no user name', async () => {
      const tls = await env.service.saveEmail({
        host: 'smtp.example.test',
        secure: 'tls',
        fromAddress: 'a@example.test',
      })
      expect(tls.port).toBe(465)
      const none = await env.service.saveEmail({
        host: 'relay.internal',
        secure: 'none',
        fromAddress: 'a@example.test',
        password: 'ignored',
      })
      expect(none).toMatchObject({ port: 25, username: null, smtpPasswordSet: false })
      expect(await env.setting('smtp_username')).toBeNull()
      expect(await env.setting('smtp_password')).toBeNull()
    })

    it('refuses an e-mail step that does not pass its schema', async () => {
      for (const bad of [
        { ...SMTP, host: 'bad host!' },
        { ...SMTP, port: 70_000 },
        { ...SMTP, secure: 'ssl' },
        { ...SMTP, fromAddress: 'nope' },
        { ...SMTP, username: 'a\r\nBcc: x@example.test' },
      ]) {
        const err = await failure(env.service.saveEmail(bad))
        expect((err as InstallError).code).toBe('invalid_input')
      }
      expect(await env.setting('smtp_host')).toBeNull()
    })

    it('skipping stores the dashboard notice, and saving a server does not count as the step', async () => {
      await env.service.saveSite(SITE)
      await env.service.skipEmail()
      const rows = await env.query<{ key: string; level: string; message_key: string; capability: string }>(
        'select key, level, message_key, capability from admin_notice',
      )
      expect(rows).toEqual([
        {
          key: SETUP_EMAIL_SKIPPED_NOTICE.key,
          level: 'warning',
          message_key: 'notices.setupEmailSkipped',
          capability: 'manage_options',
        },
      ])
      // A second skip does not make a second notice.
      await env.service.skipEmail()
      expect(await env.query('select 1 from admin_notice')).toHaveLength(1)

      await resetInstall(env)
      await env.service.saveSite(SITE)
      await env.service.saveEmail(SMTP)
      // Saved is not enough: the settings are tested, or the step is skipped.
      expect((await env.service.status()).nextStep).toBe('email')
    })

    describe('the e-mail step is done on a passed test mail or a skip, never on saved settings alone', () => {
      const fast = { timeoutMs: 400, pollMs: 5 }
      const failing = () => stubMail({ states: [{ state: 'failed' }] })
      const passing = () => stubMail({ states: [{ state: 'completed', output: { sent: true } }], worker: env.db })

      it('save, failed test, reload: still the e-mail step, install refused with step_missing and no notice', async () => {
        await env.service.saveSite(SITE)
        await env.service.saveEmail(SMTP)
        expect(await env.service.testEmail('me@example.test')).toEqual({ ok: false, error: 'queue_unavailable' }) // no mail producer
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'email' })

        const service = env.service2({ mail: failing(), emailTest: fast })
        expect(await service.testEmail('me@example.test')).toEqual({ ok: false, error: 'send_failed' })
        expect(await env.setting('smtp_verified_at')).toBeNull()
        expect(await service.status()).toEqual({ installed: false, nextStep: 'email' })
        expect(await service.state()).toMatchObject({ nextStep: 'email', emailSkipped: false })
        expect((await service.state()).email).toMatchObject({ host: SMTP.host })

        const key = await env.service.generateRecoveryKey()
        const err = await failure(service.install({ admin: admin(), recovery: { key, confirmed: true } }))
        expect(err).toMatchObject({ code: 'step_missing' })
        expect((await env.footprint()).notices).toEqual([])
        expect(await service.status()).toEqual({ installed: false, nextStep: 'email' })
      })

      it('a passed test completes the step; saving the settings again undoes it; a later passed test redoes it', async () => {
        await env.service.saveSite(SITE)
        await env.service.saveEmail(SMTP)
        const service = env.service2({ mail: passing(), emailTest: fast })
        expect(await service.testEmail('me@example.test')).toEqual({ ok: true })
        expect(CoreSettings.shape.smtp_verified_at.parse(await env.setting('smtp_verified_at'))).not.toBeNull()
        expect(await service.status()).toEqual({ installed: false, nextStep: 'admin' })

        await env.service.saveEmail({ ...SMTP, port: 2525 })
        expect(await env.setting('smtp_verified_at')).toBeNull()
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'email' })

        expect(await service.testEmail('me@example.test')).toEqual({ ok: true })
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'admin' })
      })

      it('a passed test lets the install through', async () => {
        await env.service.saveSite(SITE)
        await env.service.saveEmail(SMTP)
        const key = await env.service.generateRecoveryKey()
        await env.service2({ mail: passing(), emailTest: fast }).testEmail('me@example.test')
        const result = await env.service.install({ admin: admin(), recovery: { key, confirmed: true } })
        expect(result.username).toBe('tor')
        expect(await env.service.status()).toEqual({ installed: true, nextStep: null })
      })

      it('a failed test leaves a skip standing, and a passed one still removes the notice', async () => {
        await env.service.saveSite(SITE)
        await env.service.saveEmail(SMTP)
        await env.service.skipEmail()
        await env.service2({ mail: failing(), emailTest: fast }).testEmail('me@example.test')
        expect((await env.footprint()).notices).toEqual([SETUP_EMAIL_SKIPPED_NOTICE.key])
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'admin' })
        await env.service2({ mail: passing(), emailTest: fast }).testEmail('me@example.test')
        expect((await env.footprint()).notices).toEqual([])
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'admin' })
      })

      it('does not mark settings that were saved again while the test was running', async () => {
        await env.service.saveSite(SITE)
        await env.service.saveEmail(SMTP)
        const mail = passing()
        const racing: typeof mail = {
          ...mail,
          jobState: async (id: string) => {
            await env.service.saveEmail({ ...SMTP, port: 2525 })
            return mail.jobState(id)
          },
        }
        await env.service2({ mail: racing, emailTest: fast }).testEmail('me@example.test')
        expect(await env.setting('smtp_verified_at')).toBeNull()
        expect(await env.service.status()).toEqual({ installed: false, nextStep: 'email' })
      })
    })
  })

  describe('the system check', () => {
    it('reports a healthy install', async () => {
      const check = await env.service.systemCheck({ origin: TEST_ORIGIN })
      expect(check).toMatchObject({
        ok: true,
        database: { ok: true },
        migrations: { ok: true },
        encryptionKey: { ok: true, version: 1 },
        signingKey: { ok: true },
        proxy: { state: 'configured' },
        origin: { ok: true, configured: TEST_ORIGIN, observed: TEST_ORIGIN, source: 'origin' },
      })
      expect(check.migrations.applied).toBe(check.migrations.expected)
      expect(check.migrations.latest).toMatch(/^\d{4}_/)
    })

    it('never contains a key, a password or a token', async () => {
      const text = JSON.stringify(await env.service.systemCheck({ origin: TEST_ORIGIN }))
      expect(text).not.toContain('1f2e3d4c')
      expect(text).not.toMatch(/password|secret|token/i)
    })

    it('reports PUBLIC_ORIGIN against the address the browser used, with both values', async () => {
      const wrong = await env.service.systemCheck({ referer: 'http://localhost:3000/admin/setup?token=abc' })
      expect(wrong.ok).toBe(false)
      expect(wrong.origin).toEqual({
        ok: false,
        configured: TEST_ORIGIN,
        observed: 'http://localhost:3000',
        source: 'referer',
      })
      // The scheme matters: the cookies are `Secure` and the Origin check compares the whole origin.
      const scheme = await env.service.systemCheck({ origin: 'http://cms.example.test' })
      expect(scheme.origin).toMatchObject({ ok: false, observed: 'http://cms.example.test' })
      const host = await env.service.systemCheck({ host: 'other.example.test' })
      expect(host.origin).toEqual({
        ok: false,
        configured: TEST_ORIGIN,
        observed: 'https://other.example.test',
        source: 'host',
      })
      // Nothing to tell it by: not a failure.
      expect((await env.service.systemCheck({})).origin).toEqual({
        ok: true,
        configured: TEST_ORIGIN,
        observed: null,
        source: null,
      })
    })

    it('passes on the M0.3 proxy state, which warns and does not block', async () => {
      const other = env.service2({ proxyStatus: () => ({ state: 'warning', observed: 50, address: '172.18.0.2' }) })
      const check = await other.systemCheck({ origin: TEST_ORIGIN })
      expect(check.proxy).toEqual({ state: 'warning', observed: 50, address: '172.18.0.2' })
      expect(check.ok).toBe(true)
    })

    it('fails the migration check for a journal newer than the database, and the signing key for a wrong size', async () => {
      const other = env.service2({ signingKeyBytes: 16, migrationsFolder: await newerJournal() })
      const check = await other.systemCheck({ origin: TEST_ORIGIN })
      expect(check.migrations.ok).toBe(false)
      expect(check.migrations.latest).toBe('0099_newer')
      expect(check.migrations.applied).toBe(check.migrations.expected - 1)
      expect(check.signingKey.ok).toBe(false)
      expect(check.ok).toBe(false)
    })
  })

  describe('the test mail', () => {
    const fast = { timeoutMs: 400, pollMs: 5 }

    it('succeeds only when the job completed, and then removes the skipped notice', async () => {
      await env.service.skipEmail()
      const mail = stubMail({
        states: [{ state: 'created' }, { state: 'active' }, { state: 'completed', output: { sent: true } }],
        worker: env.db,
      })
      const service = env.service2({ mail, emailTest: fast })
      expect(await service.testEmail('me@example.test')).toEqual({ ok: true })
      expect(mail.polls).toBe(3)
      expect((await env.footprint()).notices).toEqual([])

      // One try, no retries, dropped from the queue soon: the person is waiting for the answer.
      expect(mail.sent).toHaveLength(1)
      expect(mail.sent[0]?.message).toMatchObject({ template: 'test', to: 'me@example.test' })
      expect(mail.sent[0]?.options).toMatchObject({ retryLimit: 0, retentionSeconds: 90 })
    })

    it("only reports the job: marking the e-mail as verified is the worker's job (markEmailVerified), not the wizard's", async () => {
      await env.service.saveSite(SITE)
      await env.service.saveEmail(SMTP)
      await env.service.skipEmail()
      // A queue whose worker marks nothing: the job completes, the wizard says so, and writes nothing itself.
      const service = env.service2({ mail: stubMail({ states: [{ state: 'completed' }] }), emailTest: fast })
      expect(await service.testEmail('me@example.test')).toEqual({ ok: true })
      expect(await env.setting('smtp_verified_at')).toBeNull()
      expect((await env.footprint()).notices).toEqual([SETUP_EMAIL_SKIPPED_NOTICE.key])
    })

    it('says send_failed or mail_config from the worker, and nothing else the worker wrote', async () => {
      for (const [output, error] of [
        [{ error: 'send_failed' }, 'send_failed'],
        [{ error: 'mail_config' }, 'mail_config'],
        [{ error: 'ECONNREFUSED smtp-user@example.test password hunter2' }, 'send_failed'],
        [{ error: { nested: 'smtp-secret-pw' } }, 'send_failed'],
        [null, 'send_failed'],
      ] as const) {
        const service = env.service2({ mail: stubMail({ states: [{ state: 'failed', output }] }), emailTest: fast })
        const result = await service.testEmail('me@example.test')
        expect(result, JSON.stringify(output)).toEqual({ ok: false, error })
        expect(JSON.stringify(result)).not.toMatch(/hunter2|smtp-secret-pw|smtp-user/)
      }
    })

    it('does not remove the skipped notice when the mail failed', async () => {
      await env.service.skipEmail()
      const service = env.service2({
        mail: stubMail({ states: [{ state: 'failed', output: { error: 'send_failed' } }] }),
        emailTest: fast,
      })
      await service.testEmail('me@example.test')
      expect((await env.footprint()).notices).toEqual([SETUP_EMAIL_SKIPPED_NOTICE.key])
    })

    it('gives up after the timeout, and says so', async () => {
      const mail = stubMail({ states: [{ state: 'created' }] })
      const service = env.service2({ mail, emailTest: { timeoutMs: 60, pollMs: 10 } })
      const started = Date.now()
      expect(await service.testEmail('me@example.test')).toEqual({ ok: false, error: 'timeout' })
      expect(Date.now() - started).toBeGreaterThanOrEqual(55)
      expect(mail.polls).toBeGreaterThan(2)
    })

    it('waits for a retry instead of calling it a failure (the job is not over)', async () => {
      const mail = stubMail({ states: [{ state: 'retry' }, { state: 'active' }, { state: 'completed' }] })
      expect(await env.service2({ mail, emailTest: fast }).testEmail('me@example.test')).toEqual({ ok: true })
    })

    it('reports a job that vanished and a queue that cannot be reached or that did not take the mail', async () => {
      expect(
        await env.service2({ mail: stubMail({ states: [null] }), emailTest: fast }).testEmail('me@example.test'),
      ).toEqual({ ok: false, error: 'send_failed' })
      expect(
        await env
          .service2({
            mail: stubMail({ states: [], sendError: new Error('connect ECONNREFUSED 10.0.0.5:5432') }),
            emailTest: fast,
          })
          .testEmail('me@example.test'),
      ).toEqual({ ok: false, error: 'queue_unavailable' })
      expect(
        await env
          .service2({ mail: stubMail({ states: [], stateError: new Error('boom') }), emailTest: fast })
          .testEmail('me@example.test'),
      ).toEqual({ ok: false, error: 'queue_unavailable' })
      expect(
        await env
          .service2({ mail: stubMail({ states: [], jobId: null }), emailTest: fast })
          .testEmail('me@example.test'),
      ).toEqual({ ok: false, error: 'queue_unavailable' })
      // No queue at all (a process that has none).
      expect(await env.service2({}).testEmail('me@example.test')).toEqual({ ok: false, error: 'queue_unavailable' })
    })

    it('runs one test at a time: a second one while the first waits answers busy, and the next after it is fine', async () => {
      const mail = stubMail({ states: [{ state: 'created' }, { state: 'created' }, { state: 'completed' }] })
      const service = env.service2({ mail, emailTest: { timeoutMs: 2000, pollMs: 40 } })
      const first = service.testEmail('me@example.test')
      expect(await service.testEmail('me@example.test')).toEqual({ ok: false, error: 'busy' })
      expect(await first).toEqual({ ok: true })
      expect(mail.sent).toHaveLength(1)
      const again = stubMail({ states: [{ state: 'completed' }] })
      expect(await env.service2({ mail: again, emailTest: fast }).testEmail('me@example.test')).toEqual({ ok: true })
    })

    it('gives every test a queue key of its own, so the queue cannot drop a second test of the same address', async () => {
      const mail = stubMail({ states: [{ state: 'completed' }] })
      const service = env.service2({ mail, emailTest: fast })
      await service.testEmail('me@example.test')
      await service.testEmail('me@example.test')
      const keys = mail.sent.map((m) => m.options.throttle.key)
      expect(new Set(keys).size).toBe(2)
    })

    it('refuses an address that is none, before anything is queued', async () => {
      const mail = stubMail({ states: [{ state: 'completed' }] })
      const err = await failure(env.service2({ mail }).testEmail('not an address'))
      expect((err as InstallError).code).toBe('invalid_input')
      expect(mail.sent).toHaveLength(0)
    })
  })

  describe('the recovery key', () => {
    it('stores a verifier and not the key, and a new key replaces the old one', async () => {
      const first = await env.service.generateRecoveryKey()
      const second = await env.service.generateRecoveryKey()
      expect(first).not.toBe(second)
      const rows = await env.query<{ secret_hash: string }>(
        `select secret_hash from site_secret where purpose = 'backup_recovery_key'`,
      )
      expect(rows).toEqual([{ secret_hash: recoveryKeyVerifier(second) }])
      expect(JSON.stringify(rows)).not.toContain(second.replaceAll('-', ''))
    })
  })

  describe('the install', () => {
    it('makes the administrator, the default content and the flag, and removes the token', async () => {
      const token = await env.service.issueSetupToken()
      const key = await prepare(env)

      const result = await env.service.install({
        admin: admin('tor'),
        recovery: { key, confirmed: true },
        context: { ip: '203.0.113.9', requestId: 'req-1' },
      })

      expect(result).toMatchObject({ username: 'tor', email: 'tor@example.test', recoveryKey: null })
      expect(result.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)

      expect(await env.setting('installed')).toBe(true)
      expect(await env.setting('installed_at')).toBe(result.installedAt)
      expect(await env.setting('admin_email')).toBe('ansvarlig@example.test')
      expect(await env.setting('default_category')).toBe(result.defaultContent.categoryId)
      expect(await env.setting('wp_page_for_privacy_policy')).toBe(result.defaultContent.privacyPolicyPageId)

      const accounts = await env.query<{
        id: string
        username: string
        status: string
        password_hash: string
        roles: string[]
      }>(
        `select a.id, a.username, a.status, a.password_hash,
                array(select r.slug from account_role ar join role r on r.id = ar.role_id where ar.account_id = a.id) as roles
           from account a`,
      )
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toMatchObject({
        id: result.accountId,
        username: 'tor',
        status: 'active',
        roles: ['administrator'],
      })
      expect(accounts[0]?.password_hash).toMatch(/^\$argon2id\$/)
      expect(await verifyPassword('a long and fine password', accounts[0]?.password_hash ?? '')).toMatchObject({
        valid: true,
      })

      const posts = await env.query<{ title: string; status: string; slug: string }>(
        `select title, status, slug from content order by short_id`,
      )
      expect(posts.map((p) => p.title)).toEqual(['Hei, verden!', 'Testside', 'Personvernerklæring'])
      expect(posts.map((p) => p.status)).toEqual(['publish', 'publish', 'draft'])
      expect(await env.query('select 1 from comment')).toHaveLength(1)

      // The token is gone, the recovery verifier is the key's, and nothing else is a secret row.
      expect((await env.footprint()).secrets).toEqual(['backup_recovery_key'])
      expect(await env.service.verifySetupToken(token)).toBe(false)
      const verifier = await env.query<{ secret_hash: string }>(`select secret_hash from site_secret`)
      expect(verifier[0]?.secret_hash).toBe(recoveryKeyVerifier(key))

      // One audit entry, by the new administrator, from the setup, with no secret in it.
      const audit = await env.query<{
        actor: string
        account_id: string
        source: string
        ip: string
        correlation_id: string
        new_value: unknown
      }>(
        `select actor, account_id, source, host(ip) as ip, correlation_id, new_value from audit_log where action = 'site.installed'`,
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actor: 'tor',
        account_id: result.accountId,
        source: 'setup',
        ip: '203.0.113.9',
        correlation_id: 'req-1',
      })
      const auditText = JSON.stringify(audit)
      for (const secret of ['a long and fine password', key, key.replaceAll('-', ''), token, '$argon2']) {
        expect(auditText).not.toContain(secret)
      }

      expect(await env.service.status()).toEqual({ installed: true, nextStep: null })
    })

    it('does the whole install in one call for the cli: site, e-mail skipped, and a key it makes and returns', async () => {
      const result = await env.service.install({
        admin: admin('klara'),
        site: SITE,
        email: { skip: true },
        source: 'cli',
      })
      expect(result.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/)
      const verifier = await env.query<{ secret_hash: string }>(
        `select secret_hash from site_secret where purpose = 'backup_recovery_key'`,
      )
      expect(verifier[0]?.secret_hash).toBe(recoveryKeyVerifier(result.recoveryKey ?? ''))
      expect(await env.setting('blogname')).toBe('Min blogg')
      expect((await env.footprint()).notices).toEqual([SETUP_EMAIL_SKIPPED_NOTICE.key])
      const audit = await env.query<{ source: string }>(`select source from audit_log where action = 'site.installed'`)
      expect(audit).toEqual([{ source: 'cli' }])
    })

    it('does the whole install with an SMTP server too once it is tested, the password encrypted', async () => {
      await env.service.saveSite(SITE)
      await env.service.saveEmail(SMTP)
      await env
        .service2({
          mail: stubMail({ states: [{ state: 'completed' }], worker: env.db }),
          emailTest: { timeoutMs: 400, pollMs: 5 },
        })
        .testEmail('me@example.test')
      await env.service.install({ admin: admin(), site: SITE })
      expect(await env.setting('smtp_host')).toBe('smtp.example.test')
      expect(await testKeyRing.decrypt(String(await env.setting('smtp_password')), SMTP_PASSWORD_AAD)).toBe(
        SMTP.password,
      )
      expect((await env.footprint()).notices).toEqual([])
    })

    it('lets the cli leave the mail to the SMTP defaults of the environment: nothing saved, no notice, and the audit says so', async () => {
      await env.service.install({ admin: admin('env'), site: SITE, email: { fromEnvironment: true }, source: 'cli' })
      expect(await env.setting('smtp_host')).toBeNull()
      expect((await env.footprint()).notices).toEqual([])
      const audit = await env.query<{ new_value: Record<string, unknown> }>(
        `select new_value from audit_log where action = 'site.installed'`,
      )
      expect(audit[0]?.new_value).toMatchObject({
        emailConfigured: false,
        emailSkipped: false,
        emailFromEnvironment: true,
      })
      expect(await env.service.status()).toEqual({ installed: true, nextStep: null })
    })

    it('still needs the e-mail step from a caller that does not say how the mail is done', async () => {
      const err = await failure(env.service.install({ admin: admin('nomail'), site: SITE }))
      expect(err).toMatchObject({ code: 'step_missing' })
      expect((await env.footprint()).notices).toEqual([])
    })

    it('uses the administrator’s address for admin_email when no site step set one', async () => {
      await env.service.saveSite(SITE)
      await env.service.skipEmail()
      await env.owner.query(`update setting set value = 'null'::jsonb where key = 'admin_email'`)
      await env.service.install({ admin: admin('mari') })
      expect(await env.setting('admin_email')).toBe('mari@example.test')
    })

    it('needs the steps: no site, no e-mail step, no recovery key', async () => {
      const key = await env.service.generateRecoveryKey()
      let err = await failure(env.service.install({ admin: admin(), recovery: { key, confirmed: true } }))
      expect(err).toMatchObject({ code: 'step_missing', message: expect.stringContaining('site') as string })

      await env.service.saveSite(SITE)
      err = await failure(env.service.install({ admin: admin(), recovery: { key, confirmed: true } }))
      expect(err).toMatchObject({ code: 'step_missing', message: expect.stringContaining('e-mail') as string })

      await env.service.skipEmail()
      await resetRecovery(env)
      err = await failure(env.service.install({ admin: admin(), recovery: { key, confirmed: true } }))
      expect(err).toMatchObject({ code: 'recovery_key_mismatch' })
      expect((await env.footprint()).accounts).toBe(0)
    })

    it('refuses a recovery key that is not the one the server made last', async () => {
      const first = await prepare(env)
      const second = await env.service.generateRecoveryKey()
      for (const key of [first, generateRecoveryKey(), 'not a key', '']) {
        const err = await failure(env.service.install({ admin: admin(), recovery: { key, confirmed: true } }))
        expect(err, key).toMatchObject({ code: 'recovery_key_mismatch' })
      }
      expect(await env.setting('installed')).toBe(false)
      // The latest one works, typed the way a person types it.
      await env.service.install({
        admin: admin(),
        recovery: { key: second.toLowerCase().replaceAll('-', ' '), confirmed: true },
      })
      expect(await env.setting('installed')).toBe(true)
    })

    it('refuses a password equal to the username or the e-mail address, case aside, and writes nothing', async () => {
      const key = await prepare(env)
      const token = await env.service.issueSetupToken()
      for (const password of [
        'administrator',
        'ADMINISTRATOR',
        'Administrator@Example.Test',
        'administrator@example.test',
      ]) {
        const err = await failure(
          env.service.install({
            admin: { username: 'administrator', email: 'administrator@example.test', password },
            recovery: { key, confirmed: true },
          }),
        )
        expect(err).toBeInstanceOf(InstallError)
        expect((err as InstallError).code).toBe('weak_password')
        expect((err as InstallError).message).toBe(WEAK_PASSWORD_MESSAGE)
        expect((err as InstallError).message).not.toContain(password)
      }
      expect((await env.footprint()).accounts).toBe(0)
      expect(await env.setting('installed')).toBe(false)
      expect(await env.service.verifySetupToken(token)).toBe(true)
    })

    it('validates the administrator with the rules of every other account, and shows no value', async () => {
      const key = await prepare(env)
      for (const bad of [
        { ...admin(), password: 'short' },
        { ...admin(), username: 'a b' },
        { ...admin(), username: 'ab' },
        { ...admin(), email: 'nope' },
        { ...admin(), extra: 1 },
      ]) {
        const err = await failure(env.service.install({ admin: bad, recovery: { key, confirmed: true } }))
        expect(err).toBeInstanceOf(InstallError)
        expect((err as InstallError).code).toBe('invalid_input')
        expect((err as InstallError).message).not.toContain('short')
        expect((err as InstallError).message).not.toContain('a b')
      }
      expect((await env.footprint()).accounts).toBe(0)
    })

    it('answers already installed the second time and changes nothing', async () => {
      const key = await prepare(env)
      await env.service.install({ admin: admin('first'), recovery: { key, confirmed: true } })
      const before = await env.footprint()
      const err = await failure(env.service.install({ admin: admin('second'), site: SITE, email: { skip: true } }))
      expect(err).toBeInstanceOf(AlreadyInstalledError)
      expect(await env.footprint()).toEqual(before)
    })

    it('closes every step for an installed site', async () => {
      const key = await prepare(env)
      await env.service.install({ admin: admin(), recovery: { key, confirmed: true } })
      const before = await env.footprint()
      await expect(env.service.saveSite({ ...SITE, title: 'Overtatt' })).rejects.toBeInstanceOf(AlreadyInstalledError)
      await expect(env.service.saveEmail(SMTP)).rejects.toBeInstanceOf(AlreadyInstalledError)
      await expect(env.service.skipEmail()).rejects.toBeInstanceOf(AlreadyInstalledError)
      await expect(env.service.generateRecoveryKey()).rejects.toBeInstanceOf(AlreadyInstalledError)
      await expect(env.service.issueSetupToken()).rejects.toBeInstanceOf(AlreadyInstalledError)
      expect(await env.setting('blogname')).toBe('Min blogg')
      expect(await env.setting('smtp_host')).toBeNull()
      expect(await env.footprint()).toEqual(before)
    })

    it('lets exactly one of two installs at once win, with one administrator and one set of content', async () => {
      const key = await prepare(env)
      const results = await Promise.allSettled([
        env.service.install({ admin: admin('anna'), recovery: { key, confirmed: true } }),
        env.service.install({ admin: admin('bjorn'), recovery: { key, confirmed: true } }),
      ])
      const won = results.filter((r) => r.status === 'fulfilled')
      const lost = results.filter((r) => r.status === 'rejected')
      expect(won).toHaveLength(1)
      expect(lost).toHaveLength(1)
      expect(lost[0]?.reason).toBeInstanceOf(AlreadyInstalledError)

      const footprint = await env.footprint()
      expect(footprint.accounts).toBe(1)
      expect(footprint.auditInstalled).toBe(1)
      expect(await env.query(`select 1 from content where slug = 'hei-verden'`)).toHaveLength(1)
      expect(footprint.contents).toBe(3)
      expect(footprint.comments).toBe(1)
      expect((await env.query<{ username: string }>('select username from account'))[0]?.username).toBe(
        (won[0] as PromiseFulfilledResult<{ username: string }>).value.username,
      )
    })

    it('lets exactly one of many installs at once win', async () => {
      const key = await prepare(env)
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          env.service.install({ admin: admin(`user${String(i)}`), recovery: { key, confirmed: true } }),
        ),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(AlreadyInstalledError)
        }
      }
      expect((await env.footprint()).accounts).toBe(1)
      expect((await env.footprint()).contents).toBe(3)
    })

    it('rolls back everything when the e-mail address is taken, after the lock and the site step were written', async () => {
      await env.owner.query(
        `insert into account (username, email, display_name, nicename, status) values ('already', 'tor@example.test', 'already', 'already', 'active')`,
      )
      await env.service.issueSetupToken()
      const before = await env.footprint()

      const err = await failure(env.service.install({ admin: admin('tor'), site: SITE, email: { skip: true } }))
      expect(err).toMatchObject({ code: 'email_taken' })

      // Nothing of the one-shot install is left: no site settings, no SMTP, no key, no content, no flag.
      expect(await env.setting('installed')).toBe(false)
      expect(await env.setting('blogname')).toBe('')
      expect(await env.setting('smtp_host')).toBeNull()
      expect(await env.setting('smtp_password')).toBeNull()
      expect(await env.footprint()).toEqual({ ...before, secrets: ['setup_token'] })
      // The token still works: the person can correct the form and try again.
      expect(before.secrets).toEqual(['setup_token'])
    })

    it('rolls back the administrator when the username is taken', async () => {
      await env.owner.query(
        `insert into account (username, email, display_name, nicename, status) values ('TOR', 'other@example.test', 'x', 'tor', 'active')`,
      )
      const key = await prepare(env)
      const err = await failure(env.service.install({ admin: admin('tor'), recovery: { key, confirmed: true } }))
      expect(err).toMatchObject({ code: 'username_taken' })
      expect((await env.footprint()).accounts).toBe(1)
      expect(await env.setting('installed')).toBe(false)
    })

    it('rolls back the administrator and everything else when the default content cannot be made', async () => {
      const key = await prepare(env)
      // Some of the default content is there already: the seed refuses, after the account was inserted in the same transaction.
      await env.owner.query(
        `insert into account (username, email, display_name, nicename, status) values ('seeder', 'seeder@example.test', 's', 'seeder', 'active')`,
      )
      const seeder = (await env.query<{ id: string }>(`select id from account where username = 'seeder'`))[0]?.id ?? ''
      await seedDefaultContent(env.db, { siteUrl: TEST_ORIGIN, adminAccountId: seeder, locale: 'nb' })
      const before = await env.footprint()
      expect(before.contents).toBe(3)

      const err = await failure(env.service.install({ admin: admin('tor'), recovery: { key, confirmed: true } }))
      expect(err).toMatchObject({ code: 'content_exists' })
      expect((err as InstallError).cause).toBeInstanceOf(DefaultContentExistsError)
      expect(await env.footprint()).toEqual(before)
      expect(await env.setting('installed')).toBe(false)
      expect(await env.query(`select 1 from account where username = 'tor'`)).toHaveLength(0)
    })

    it('makes the default content in English for another language, linked to the administrator', async () => {
      await env.service.saveSite({ ...SITE, locale: 'en' })
      await env.service.skipEmail()
      const key = await env.service.generateRecoveryKey()
      const result = await env.service.install({ admin: admin(), recovery: { key, confirmed: true } })
      const titles = await env.query<{ title: string }>(`select title from content order by short_id`)
      expect(titles.map((t) => t.title)).toEqual(['Hello world!', 'Sample Page', 'Privacy Policy'])
      const authors = await env.query<{ account_id: string }>(`select distinct account_id from content_author`)
      expect(authors).toEqual([{ account_id: result.accountId }])
    })

    it('remembers «installed» for good, and «not installed» only for the time it was told to', async () => {
      const slow = env.service2({ notInstalledCacheMs: 60_000 })
      expect(await slow.isInstalled()).toBe(false)
      await env.owner.query(`update setting set value = 'true'::jsonb where key = 'installed'`)
      // Within the cache time the old answer stands; the other instance, with no cache, sees the new one.
      expect(await slow.isInstalled()).toBe(false)
      expect(await env.service.isInstalled()).toBe(true)
      slow.forgetInstalled()
      expect(await slow.isInstalled()).toBe(true)
      // «Installed» is not looked up again, even if the row went away.
      await env.owner.query(`update setting set value = 'false'::jsonb where key = 'installed'`)
      expect(await slow.isInstalled()).toBe(true)
    })

    it('waits for an install that holds the lock instead of writing around it', async () => {
      // A second connection holds the install lock in a transaction, as a running install would.
      const holder = await env.owner.connect()
      let saved = false
      try {
        await holder.query('begin')
        await holder.query('select pg_advisory_xact_lock(1953456489::bigint)')
        const pending = env.service.saveSite(SITE).then(() => {
          saved = true
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        expect(saved).toBe(false)
        expect(await env.setting('blogname')).toBe('')
        await holder.query('commit')
        await pending
        expect(saved).toBe(true)
        expect(await env.setting('blogname')).toBe('Min blogg')
      } finally {
        holder.release()
      }
    })
  })
})

/** A journal folder with one more migration than the database has, later than any applied. */
async function newerJournal(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'toascribe-install-journal-'))
  await mkdir(join(dir, 'meta'))
  const entries = [...readMigrationJournal(), { tag: '0099_newer', when: Date.now() + 86_400_000 }]
  await writeFile(join(dir, 'meta', '_journal.json'), JSON.stringify({ entries }))
  return dir
}

/** Removes the staged recovery key, as if the wizard had not made one. */
async function resetRecovery(env: InstallEnv): Promise<void> {
  await env.owner.query(`delete from site_secret where purpose = 'backup_recovery_key'`)
}
