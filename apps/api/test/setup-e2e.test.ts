// The e-mail step of the wizard end to end, as separate processes: the api queues the test mail through pg-boss, a real worker
// process sends it through SMTP, and Mailpit holds the message. Needs TEST_DATABASE_URL, MAILPIT_URL and MAILPIT_SMTP; skips,
// with a notice, without. The rest of the setup API is in setup.test.ts.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SetupEmailResponse,
  SetupEmailTestResponse,
  SetupRecoveryKeyResponse,
  SetupStateResponse,
} from '@toascribe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createMailQueue } from '../src/adapters/mail-queue.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_ENCRYPTION_KEY_HEX, TEST_ORIGIN, memoryLogger, testKeyRing } from './helpers.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { mailpitConfig, noticeIfMailpitSkipped, uniqueAddress, waitForMessage } from './mailpit.ts'
import { ADMIN, SITE, resetSite, setupCall } from './setup-helpers.ts'

noticeIfSkipped('setup-e2e')
noticeIfMailpitSkipped('setup-e2e')

const mailpit = mailpitConfig()
const WORKER_ENTRY = fileURLToPath(new URL('../../worker/src/index.ts', import.meta.url))

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

describe.skipIf(TEST_DATABASE_URL === undefined || mailpit === undefined)(
  'the wizard’s test mail: api -> queue -> worker process -> SMTP -> Mailpit (needs TEST_DATABASE_URL, MAILPIT_URL, MAILPIT_SMTP)',
  () => {
    let env: AuthTestApp
    let worker: ChildProcess
    let dir: string
    let workerOutput = ''
    let token: string
    let counter = 0

    function config() {
      if (mailpit === undefined) {
        throw new Error('unreachable: the suite is skipped without Mailpit')
      }
      return mailpit
    }

    beforeAll(async () => {
      env = await startAuthApp({
        mail: (database) =>
          createMailQueue({ connectionString: database.appUrl, keyRing: testKeyRing, logger: memoryLogger().logger }),
      })
      dir = await mkdtemp(join(tmpdir(), 'toascribe-setup-e2e-'))
      // The worker has no SMTP server in its environment: everything it sends with comes from the settings the wizard saved.
      worker = spawn(process.execPath, ['--conditions=source', WORKER_ENTRY], {
        env: {
          ...stringEnv(),
          NODE_ENV: 'test',
          LOG_LEVEL: 'debug',
          DATABASE_URL: env.database.appUrl,
          PUBLIC_ORIGIN: TEST_ORIGIN,
          TOASCRIBE_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_HEX,
          SMTP_HOST: '',
          MAIL_FROM_ADDRESS: '',
          WORKER_HEARTBEAT_FILE: join(dir, 'heartbeat'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      worker.stdout?.on('data', (chunk: Buffer) => (workerOutput += chunk.toString()))
      worker.stderr?.on('data', (chunk: Buffer) => (workerOutput += chunk.toString()))
      const deadline = Date.now() + 30_000
      while (!workerOutput.includes('worker ready')) {
        if (Date.now() > deadline || worker.exitCode !== null) {
          throw new Error(`the worker did not start:\n${workerOutput}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    })

    afterAll(async () => {
      const exited = new Promise<void>((resolve) => {
        if (worker.exitCode !== null) {
          resolve()
        } else {
          worker.once('close', () => {
            resolve()
          })
        }
      })
      worker.kill('SIGTERM')
      await exited
      await rm(dir, { recursive: true, force: true })
      await env.close()
    })

    beforeEach(async () => {
      await resetSite(env)
      token = await env.services.install.issueSetupToken()
    })

    function wizard() {
      counter += 1
      return env.client({ ip: `198.51.100.${String(60 + counter)}` })
    }

    /** The e-mail step pointed at Mailpit (plain SMTP, no login), as a person would fill it in. */
    function mailpitSettings(overrides: Record<string, unknown> = {}) {
      const mp = config()
      return {
        host: mp.smtpHost,
        port: mp.smtpPort,
        secure: 'none',
        fromAddress: 'noreply@cms.example.test',
        fromName: 'Min blogg',
        ...overrides,
      }
    }

    it('sends the test mail with the saved settings and says ok only when the worker handed it over', async () => {
      const client = wizard()
      expect((await setupCall(client, 'PUT', '/site', token, SITE)).status).toBe(200)
      expect((await setupCall(client, 'PUT', '/email', token, mailpitSettings())).status).toBe(200)

      const to = uniqueAddress('setup-ok')
      const res = await setupCall(client, 'POST', '/email/test', token, { to })
      expect(res.status).toBe(200)
      expect(SetupEmailTestResponse.parse(await res.json())).toEqual({ ok: true })

      const message = await waitForMessage(config(), to)
      expect(message.Subject).toBe('[Min blogg] Test av e-post')
      expect(message.To).toEqual([{ Name: '', Address: to }])
      expect(message.From).toEqual({ Name: 'Min blogg', Address: 'noreply@cms.example.test' })
      expect(message.Text).toContain('Dette er en testmelding fra Min blogg.')
      expect(message.Text).toContain('Meldingen er sendt etter ønske fra oppsettsveiviseren.')

      // The job was tried once, not for half an hour, and has finished.
      const [job] = await env.query<{ state: string; retry_limit: number }>(
        `select state, retry_limit from pgboss.job where name = 'email.send' order by created_on desc limit 1`,
      )
      expect(job).toEqual({ state: 'completed', retry_limit: 0 })

      // The worker marked the e-mail as verified before it finished the job (markEmailVerified): the wizard only reports it.
      const [verified] = await env.query<{ value: unknown }>(`select value from setting where key = 'smtp_verified_at'`)
      expect(typeof verified?.value).toBe('string')
      const state = await setupCall(client, 'GET', '/state', token)
      expect(await state.json()).toMatchObject({ nextStep: 'admin' })
    })

    it('a test that works removes the notice that the step was skipped', async () => {
      const client = wizard()
      await setupCall(client, 'PUT', '/site', token, SITE)
      await setupCall(client, 'POST', '/email/skip', token)
      expect(await env.query('select 1 from admin_notice')).toHaveLength(1)
      await setupCall(client, 'PUT', '/email', token, mailpitSettings())
      const to = uniqueAddress('setup-resolve')
      expect(
        SetupEmailTestResponse.parse(await (await setupCall(client, 'POST', '/email/test', token, { to })).json()),
      ).toEqual({
        ok: true,
      })
      await waitForMessage(config(), to)
      expect(await env.query('select 1 from admin_notice')).toHaveLength(0)
    })

    it('a wrong host fails cleanly and at once: a code, no retry, and none of the settings in the answer', async () => {
      const client = wizard()
      await setupCall(client, 'PUT', '/site', token, SITE)
      const wrong = mailpitSettings({
        host: '127.0.0.1',
        port: 1,
        secure: 'none',
        username: 'mailer-user',
        password: 'smtp-secret-pw-9',
      })
      await setupCall(client, 'PUT', '/email', token, wrong)

      const started = Date.now()
      const res = await setupCall(client, 'POST', '/email/test', token, { to: uniqueAddress('setup-wrong') })
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ ok: false, error: 'send_failed' })
      expect(Date.now() - started).toBeLessThan(20_000)
      for (const secret of ['smtp-secret-pw-9', 'mailer-user', '127.0.0.1', 'ECONNREFUSED']) {
        expect(text).not.toContain(secret)
      }

      const [job] = await env.query<{ state: string; retry_limit: number; retry_count: number }>(
        `select state, retry_limit, retry_count from pgboss.job where name = 'email.send' order by created_on desc limit 1`,
      )
      expect(job).toEqual({ state: 'failed', retry_limit: 0, retry_count: 0 })
      // The password reached neither the worker's log nor the job table.
      expect(workerOutput).not.toContain('smtp-secret-pw-9')
      expect(JSON.stringify(await env.query('select data, output from pgboss.job'))).not.toContain('smtp-secret-pw-9')
      expect(JSON.stringify(env.lines)).not.toContain('smtp-secret-pw-9')
    })

    it('the e-mail step is done only on a passed test: a failed one survives a reload, install is refused, and a changed save undoes a pass', async () => {
      const client = wizard()
      await setupCall(client, 'PUT', '/site', token, SITE)
      const nextStep = async () =>
        SetupStateResponse.parse(await (await setupCall(client, 'GET', '/state', token)).json()).nextStep
      const unreachable = mailpitSettings({ host: '127.0.0.1', port: 1 })
      const saved = SetupEmailResponse.parse(
        await (await setupCall(client, 'PUT', '/email', token, unreachable)).json(),
      )
      expect(saved.nextStep).toBe('email')

      const failed = await setupCall(client, 'POST', '/email/test', token, { to: uniqueAddress('setup-m1') })
      expect(SetupEmailTestResponse.parse(await failed.json())).toEqual({ ok: false, error: 'send_failed' })
      // A reload: the saved settings are shown, and the step is still the e-mail step. No notice was stored.
      expect(await nextStep()).toBe('email')
      expect(await env.query('select 1 from admin_notice')).toHaveLength(0)
      const { recoveryKey } = SetupRecoveryKeyResponse.parse(
        await (await setupCall(client, 'POST', '/recovery-key', token)).json(),
      )
      const refused = await setupCall(client, 'POST', '/install', token, { admin: ADMIN, recoveryKey, confirmed: true })
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({ error: { code: 'step_missing' } })

      // Corrected settings and a test that goes through.
      await setupCall(client, 'PUT', '/email', token, mailpitSettings())
      const to = uniqueAddress('setup-m1-ok')
      expect(
        SetupEmailTestResponse.parse(await (await setupCall(client, 'POST', '/email/test', token, { to })).json()),
      ).toEqual({ ok: true })
      await waitForMessage(config(), to)
      expect(await nextStep()).toBe('admin')

      // Saving the settings again means they have to be tested again.
      await setupCall(client, 'PUT', '/email', token, mailpitSettings({ fromName: 'Annet navn' }))
      expect(await nextStep()).toBe('email')
    })

    it('says mail_config when no server is set anywhere', async () => {
      const client = wizard()
      await setupCall(client, 'PUT', '/site', token, SITE)
      const res = await setupCall(client, 'POST', '/email/test', token, { to: uniqueAddress('setup-none') })
      expect(SetupEmailTestResponse.parse(await res.json())).toEqual({ ok: false, error: 'mail_config' })
    })

    it('a double click sends one mail', async () => {
      const client = wizard()
      await setupCall(client, 'PUT', '/site', token, SITE)
      await setupCall(client, 'PUT', '/email', token, mailpitSettings())
      const to = uniqueAddress('setup-twice')
      const [a, b] = await Promise.all([
        setupCall(client, 'POST', '/email/test', token, { to }),
        setupCall(client, 'POST', '/email/test', token, { to }),
      ])
      const answers = [SetupEmailTestResponse.parse(await a.json()), SetupEmailTestResponse.parse(await b.json())]
      expect(answers.filter((r) => r.ok)).toHaveLength(1)
      expect(answers.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'busy' }])
    })

    it('the whole wizard, from a database with nothing in it to a signed-in administrator, with a working test mail', async () => {
      const client = wizard()
      expect(
        (
          await setupCall(client, 'GET', '/check', token, undefined, {
            origin: null,
            headers: { referer: `${TEST_ORIGIN}/admin/setup` },
          })
        ).status,
      ).toBe(200)
      expect((await setupCall(client, 'PUT', '/site', token, SITE)).status).toBe(200)
      expect((await setupCall(client, 'PUT', '/email', token, mailpitSettings())).status).toBe(200)
      const to = uniqueAddress('setup-whole')
      expect(
        SetupEmailTestResponse.parse(await (await setupCall(client, 'POST', '/email/test', token, { to })).json()),
      ).toEqual({
        ok: true,
      })
      await waitForMessage(config(), to)
      const { recoveryKey } = SetupRecoveryKeyResponse.parse(
        await (await setupCall(client, 'POST', '/recovery-key', token)).json(),
      )
      const admin = { ...ADMIN, email: uniqueAddress('setup-admin') }
      const installed = await setupCall(client, 'POST', '/install', token, { admin, recoveryKey, confirmed: true })
      expect(installed.status).toBe(200)
      expect((await client.get('/api/v1/me')).status).toBe(200)
      expect((await wizard().login(admin.username, admin.password)).status).toBe(200)
      expect((await setupCall(wizard(), 'GET', '/state', token)).status).toBe(404)
      expect(await env.query('select 1 from admin_notice')).toHaveLength(0)

      // The installed site sends mail with the settings the wizard saved: a lost-password mail reaches Mailpit.
      expect((await wizard().post('/api/v1/auth/password/lost', { login: admin.username })).status).toBe(202)
      const reset = await waitForMessage(config(), admin.email)
      expect(reset.Subject).toBe('[Min blogg] Tilbakestill passordet')
    })
  },
)
