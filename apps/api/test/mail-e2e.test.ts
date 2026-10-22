// The whole path, as separate processes: the api queues a mail through pg-boss, a real worker process picks it up and sends it
// through SMTP, and Mailpit holds the message. Needs TEST_DATABASE_URL, MAILPIT_URL and MAILPIT_SMTP; skips, with a notice, without.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TestEmailResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMailQueue } from '../src/adapters/mail-queue.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { enrolTotp } from './flows.ts'
import { TEST_ENCRYPTION_KEY_HEX, TEST_ORIGIN, memoryLogger, testKeyRing } from './helpers.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { countMessages, mailpitConfig, noticeIfMailpitSkipped, uniqueAddress, waitForMessage } from './mailpit.ts'

noticeIfSkipped('mail-e2e')
noticeIfMailpitSkipped('mail-e2e')

const mailpit = mailpitConfig()
const WORKER_ENTRY = fileURLToPath(new URL('../../worker/src/index.ts', import.meta.url))
const TOKEN = 'zX9cVb7nMq1wErTy3uIoPa5sDfGh8jKlZxCvBnMqWe2'

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

describe.skipIf(TEST_DATABASE_URL === undefined || mailpit === undefined)(
  'api -> queue -> worker process -> SMTP -> Mailpit (needs TEST_DATABASE_URL, MAILPIT_URL, MAILPIT_SMTP)',
  () => {
    let env: AuthTestApp
    let worker: ChildProcess
    let dir: string
    let workerOutput = ''

    function config() {
      if (mailpit === undefined) {
        throw new Error('unreachable: the suite is skipped without Mailpit')
      }
      return mailpit
    }

    beforeAll(async () => {
      const mp = config()
      env = await startAuthApp({
        mail: (database) =>
          createMailQueue({ connectionString: database.appUrl, keyRing: testKeyRing, logger: pinoSilent() }),
      })
      dir = await mkdtemp(join(tmpdir(), 'toascribe-mail-e2e-'))
      // The worker is a separate process with its own environment, the way it runs in the container. The server and sender
      // come from the environment here (the defaults behind the settings).
      worker = spawn(process.execPath, ['--conditions=source', WORKER_ENTRY], {
        env: {
          ...stringEnv(),
          NODE_ENV: 'test',
          LOG_LEVEL: 'debug',
          DATABASE_URL: env.database.appUrl,
          PUBLIC_ORIGIN: TEST_ORIGIN,
          TOASCRIBE_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_HEX,
          SMTP_HOST: mp.smtpHost,
          SMTP_PORT: String(mp.smtpPort),
          SMTP_SECURE: 'none',
          MAIL_FROM_ADDRESS: 'noreply@cms.example.test',
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

    async function adminClient(name: string) {
      const account = await env.createAccount({ username: name, role: 'administrator' })
      const client = env.client({ ip: '198.51.100.31' })
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      return { client, account }
    }

    it('POST /system/test-email: the test mail arrives with the right subject, recipient, sender and bokmål text', async () => {
      const { client } = await adminClient('e2e-admin')
      const to = uniqueAddress('e2e-test')
      const res = await client.post('/api/v1/system/test-email', { to })
      expect(res.status).toBe(202)
      const { jobId } = TestEmailResponse.parse(await res.json())

      const message = await waitForMessage(config(), to)
      // No site name yet (blogname is empty), so the host of PUBLIC_ORIGIN stands in.
      expect(message.Subject).toBe('[cms.example.test] Test av e-post')
      expect(message.To).toEqual([{ Name: '', Address: to }])
      expect(message.From).toEqual({ Name: 'cms.example.test', Address: 'noreply@cms.example.test' })
      expect(message.Text).toContain('Dette er en testmelding fra cms.example.test.')
      expect(message.Text).toContain('Meldingen er sendt etter ønske fra e2e-admin.')
      expect(message.HTML).toContain('<html lang="nb">')

      const [job] = await env.query<{ state: string }>('select state from pgboss.job where id = $1', [jobId])
      expect(job?.state).toBe('completed')
    })

    it("uses the signed-in account's own address when none is given", async () => {
      const { client, account } = await adminClient('e2e-self')
      const res = await client.post('/api/v1/system/test-email')
      expect(res.status).toBe(202)
      const message = await waitForMessage(config(), account.email)
      expect(message.To).toEqual([{ Name: '', Address: account.email }])
    })

    it('a second test mail inside the window is refused with 429, and only one is sent', async () => {
      const { client } = await adminClient('e2e-twice')
      const to = uniqueAddress('e2e-twice')
      expect((await client.post('/api/v1/system/test-email', { to })).status).toBe(202)
      const again = await client.post('/api/v1/system/test-email', { to })
      expect(again.status).toBe(429)
      expect(again.headers.get('retry-after')).toBe('30')
      await waitForMessage(config(), to)
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(await countMessages(config(), to)).toBe(1)
    })

    it('a one-time link goes through with its token, and the token is in no log and no table', async () => {
      const to = uniqueAddress('e2e-link')
      const receipt = await env.services.mail.sendMail({
        template: 'set_password',
        to,
        data: { username: 'nyansatt', token: TOKEN },
      })
      const message = await waitForMessage(config(), to)
      expect(message.Subject).toBe('[cms.example.test] Velkommen! Velg passord')
      expect(message.Text).toContain(`${TEST_ORIGIN}/admin/login?action=setpassword#token=${TOKEN}`)

      // Wait for the worker to settle the job, then look everywhere the token could have been left.
      const deadline = Date.now() + 10_000
      for (;;) {
        const [job] = await env.query<{ state: string }>('select state from pgboss.job where id = $1', [receipt.jobId])
        if (job?.state === 'completed' || Date.now() > deadline) {
          expect(job?.state).toBe('completed')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(JSON.stringify(await env.query('select data, output from pgboss.job'))).not.toContain(TOKEN)
      expect(workerOutput).not.toContain(TOKEN)
      expect(workerOutput).not.toContain(to)
      expect(workerOutput).toContain('"template":"set_password"')
      expect(workerOutput).toContain('"recipientDomain":"mailpit.example.test"')
      expect(JSON.stringify(env.lines)).not.toContain(TOKEN)
    })

    /** The token in the fragment of the link in a mail's text. */
    function tokenInLink(text: string, action: string): string {
      const match = new RegExp(
        `${TEST_ORIGIN.replaceAll('.', '\\.')}/admin/login\\?action=${action}#token=([A-Za-z0-9_-]{43})`,
      ).exec(text)
      const token = match?.[1]
      if (token === undefined) {
        throw new Error(`no ${action} link in the mail`)
      }
      return token
    }

    it('lost password: the mail arrives with a working link, the link sets the password, and it works once', async () => {
      const account = await env.createAccount({ username: 'e2e-lost', email: uniqueAddress('e2e-lost') })
      const client = env.client({ ip: '198.51.100.41' })
      expect((await client.post('/api/v1/auth/password/lost', { login: account.username })).status).toBe(202)

      const message = await waitForMessage(config(), account.email)
      expect(message.Subject).toBe('[cms.example.test] Tilbakestill passordet')
      expect(message.Text).toContain('Hei e2e-lost,')
      const token = tokenInLink(message.Text, 'resetpass')
      // The link is built from PUBLIC_ORIGIN, with the token in the fragment and nowhere else.
      expect(message.Text).not.toContain(`?token=${token}`)
      expect(message.HTML).toContain(`action=resetpass#token=${token}`)

      const reset = await client.post('/api/v1/auth/password/reset', { token, password: 'reset through real mail 42' })
      expect(reset.status).toBe(204)
      expect(
        (await client.post('/api/v1/auth/password/reset', { token, password: 'reset through real mail 43' })).status,
      ).toBe(400)
      expect(
        (await env.client({ ip: '198.51.100.42' }).login(account.username, 'reset through real mail 42')).status,
      ).toBe(200)

      // Nothing about the link in the job table, the api log or the worker log.
      expect(JSON.stringify(await env.query('select data, output from pgboss.job'))).not.toContain(token)
      expect(workerOutput).not.toContain(token)
      expect(JSON.stringify(env.lines)).not.toContain(token)
    })

    it('lost password: an address with no account gets no mail at all', async () => {
      const nobody = uniqueAddress('e2e-nobody')
      const client = env.client({ ip: '198.51.100.43' })
      expect((await client.post('/api/v1/auth/password/lost', { login: nobody })).status).toBe(202)
      // Mails to a real account go through the same queue; wait for one so the absence means something.
      const probe = await env.createAccount({ username: 'e2e-probe', email: uniqueAddress('e2e-probe') })
      await client.post('/api/v1/auth/password/lost', { login: probe.username })
      await waitForMessage(config(), probe.email)
      expect(await countMessages(config(), nobody)).toBe(0)
    })

    it('registration: the welcome mail arrives, the link sets the first password, and the account is active', async () => {
      await env.query(`update setting set value = 'true'::jsonb where key = 'users_can_register'`)
      try {
        const address = uniqueAddress('e2e-register')
        const client = env.client({ ip: '198.51.100.44' })
        expect((await client.post('/api/v1/auth/register', { username: 'e2e-newcomer', email: address })).status).toBe(
          202,
        )
        const message = await waitForMessage(config(), address)
        expect(message.Subject).toBe('[cms.example.test] Velkommen! Velg passord')
        const token = tokenInLink(message.Text, 'setpassword')
        const set = await client.post('/api/v1/auth/password/set', { token, password: 'first password from mail 1' })
        expect(set.status).toBe(204)
        expect(
          (await env.client({ ip: '198.51.100.45' }).login('e2e-newcomer', 'first password from mail 1')).status,
        ).toBe(200)
      } finally {
        await env.query(`update setting set value = 'false'::jsonb where key = 'users_can_register'`)
      }
    })

    it('security notices: adding an authenticator app and changing the password each reach the owner in Mailpit, in bokmål', async () => {
      const added = await env.createAccount({ username: 'e2e-notice-mfa', email: uniqueAddress('e2e-notice-mfa') })
      const adder = env.client({ ip: '198.51.100.47' })
      expect((await adder.login(added.username, TEST_PASSWORD)).status).toBe(200)
      expect((await enrolTotp(env, adder)).response.status).toBe(200)
      const mfaMail = await waitForMessage(config(), added.email)
      expect(mfaMail.Subject).toBe('[cms.example.test] Sikkerhetsendring på kontoen din')
      expect(mfaMail.Text).toContain('Hei e2e-notice-mfa,')
      expect(mfaMail.Text).toContain('Det blir lagt til en ny autentiseringsapp (tofaktor) på kontoen din.')
      expect(mfaMail.Text).toContain('bør du bytte passord med en gang')
      expect(mfaMail.Text).not.toContain('mfa_added')
      expect(mfaMail.Text).not.toContain('#token=')

      const changed = await env.createAccount({ username: 'e2e-notice-pw', email: uniqueAddress('e2e-notice-pw') })
      const changer = env.client({ ip: '198.51.100.48' })
      expect((await changer.login(changed.username, TEST_PASSWORD)).status).toBe(200)
      const res = await changer.patch('/api/v1/me/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'a changed passphrase 7',
      })
      expect(res.status).toBe(204)
      const pwMail = await waitForMessage(config(), changed.email)
      expect(pwMail.Subject).toBe('[cms.example.test] Sikkerhetsendring på kontoen din')
      expect(pwMail.Text).toContain('Passordet på kontoen din blir endret.')
      expect(pwMail.HTML).toContain('<html lang="nb">')
    })

    it('e-mail change: the link goes to the new address, a notice to the old one, and the link switches the address', async () => {
      const account = await env.createAccount({ username: 'e2e-mover', email: uniqueAddress('e2e-old') })
      const client = env.client({ ip: '198.51.100.46' })
      expect((await client.login(account.username, TEST_PASSWORD)).status).toBe(200)
      const fresh = uniqueAddress('e2e-new')
      expect((await client.post('/api/v1/me/email-change', { newEmail: fresh, password: TEST_PASSWORD })).status).toBe(
        202,
      )

      const toNew = await waitForMessage(config(), fresh)
      expect(toNew.Subject).toBe('[cms.example.test] Bekreft den nye e-postadressen')
      const toOld = await waitForMessage(config(), account.email)
      expect(toOld.Subject).toBe('[cms.example.test] E-postadressen på kontoen din skal byttes')
      expect(toOld.Text).toContain(fresh)
      expect(toOld.Text).not.toContain('#token=')

      const token = tokenInLink(toNew.Text, 'confirmemail')
      const confirmed = await client.post('/api/v1/me/email-change/confirm', { token })
      expect(confirmed.status).toBe(200)
      expect(await confirmed.json()).toEqual({ email: fresh })
    })
  },
)

function pinoSilent() {
  return memoryLogger().logger
}
