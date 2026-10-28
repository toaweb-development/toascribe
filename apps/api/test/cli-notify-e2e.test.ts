// `--notify` on the `toa user` commands end to end, as separate processes: the cli queues the mail through pg-boss as the app role,
// a real worker process sends it through SMTP, Mailpit holds it, and the link in it works against the api. Also the owner's
// mail when someone registers with an address that has an account. Needs TEST_DATABASE_URL, MAILPIT_URL and MAILPIT_SMTP;
// skips, with a notice, without. The cli's own tests (cli/test/notify.test.ts) cover which mail is queued for whom.
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMailQueue } from '../src/adapters/mail-queue.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { unique } from './flows.ts'
import { TEST_ENCRYPTION_KEY_HEX, TEST_ORIGIN, memoryLogger, testKeyRing } from './helpers.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { mailpitConfig, noticeIfMailpitSkipped, uniqueAddress, waitForMessage } from './mailpit.ts'

noticeIfSkipped('cli-notify-e2e')
noticeIfMailpitSkipped('cli-notify-e2e')

const mailpit = mailpitConfig()
const WORKER_ENTRY = fileURLToPath(new URL('../../worker/src/index.ts', import.meta.url))
const CLI_ENTRY = fileURLToPath(new URL('../../../cli/src/index.ts', import.meta.url))
const CHOSEN_PASSWORD = 'the password the person chose 77'

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

describe.skipIf(TEST_DATABASE_URL === undefined || mailpit === undefined)(
  'toa user --notify: cli -> queue -> worker process -> SMTP -> Mailpit -> api (needs TEST_DATABASE_URL, MAILPIT_URL, MAILPIT_SMTP)',
  () => {
    let env: AuthTestApp
    let worker: ChildProcess
    let dir: string
    let workerOutput = ''
    let ipCounter = 0
    const ip = () => `198.51.100.${String(150 + (ipCounter += 1))}`

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
      dir = await mkdtemp(join(tmpdir(), 'toascribe-cli-notify-e2e-'))
      const mp = config()
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

    /** `toa …` as the container runs it: the app role's DATABASE_URL and the encryption key, for the commands that mail a link. */
    function toa(args: readonly string[]) {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          ['--conditions=source', CLI_ENTRY, ...args],
          {
            encoding: 'utf8',
            env: {
              PATH: process.env['PATH'] ?? '',
              NODE_ENV: 'production',
              DATABASE_URL: env.database.appUrl,
              TOASCRIBE_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_HEX,
            },
            timeout: 60_000,
          },
          (error, stdout, stderr) => {
            resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
          },
        )
        child.stdin?.on('error', () => undefined)
        child.stdin?.end()
      })
    }

    it('create --notify: the welcome mail arrives, its link sets the password, and the person logs in', async () => {
      const username = unique('welcome')
      const to = uniqueAddress(username)
      const made = await toa(['user', 'create', '--username', username, '--email', to, '--role', 'author', '--notify'])
      expect(made.code).toBe(0)
      expect(made.stdout).toBe('')

      const message = await waitForMessage(config(), to)
      expect(message.Subject).toContain('Velkommen')
      expect(message.To).toEqual([{ Name: '', Address: to }])
      const link = /(https?:\/\/\S+#token=\S+)/.exec(message.Text)?.[1] ?? ''
      expect(link).toContain(`${TEST_ORIGIN}/admin/login?action=`)
      const token = decodeURIComponent(link.split('#token=')[1] ?? '')
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

      // Before the link is used the account cannot log in; with it, the person chooses the password and is in.
      expect((await env.client({ ip: ip() }).login(username, CHOSEN_PASSWORD)).status).toBe(401)
      const set = await env.client({ ip: ip() }).post('/api/v1/auth/password/set', { token, password: CHOSEN_PASSWORD })
      expect(set.status).toBe(204)
      const client = env.client({ ip: ip() })
      expect((await client.login(username, CHOSEN_PASSWORD)).status).toBe(200)
      const me = await client.get('/api/v1/me')
      expect(((await me.json()) as { roles: string[] }).roles).toEqual(['author'])
      // The link works once.
      const again = await env
        .client({ ip: ip() })
        .post('/api/v1/auth/password/set', { token, password: CHOSEN_PASSWORD })
      expect(again.status).toBe(400)
      // The token reached the job table sealed, and no log of the worker holds it.
      expect(JSON.stringify(await env.query('select data from pgboss.job'))).not.toContain(token)
      expect(workerOutput).not.toContain(token)
    })

    it('reset-password --notify: the owner gets a notice that an administrator changed the password, without the password', async () => {
      const username = unique('resetmail')
      const to = uniqueAddress(username)
      await toa(['user', 'create', '--username', username, '--email', to, '--role', 'editor'])
      const reset = await toa(['user', 'reset-password', '--username', username, '--notify'])
      expect(reset.code).toBe(0)
      const password = reset.stdout.trim()
      expect(password).toMatch(/^\S{24}$/)

      const message = await waitForMessage(config(), to)
      expect(message.Subject).toContain('Sikkerhetsendring')
      expect(message.Text).toContain('byttet av en administrator')
      expect(message.Text).not.toContain(password)
      expect(message.HTML).not.toContain(password)
      expect((await env.client({ ip: ip() }).login(username, password)).status).toBe(200)
    })

    it('reset-login-limit --notify: the owner gets a short notice', async () => {
      const username = unique('limitmail')
      const to = uniqueAddress(username)
      await toa(['user', 'create', '--username', username, '--email', to, '--role', 'editor'])
      const result = await toa(['user', 'reset-login-limit', '--username', username, '--notify'])
      expect(result.code).toBe(0)
      const message = await waitForMessage(config(), to)
      expect(message.Text).toContain('Ventetiden etter mislykkede innloggingsforsøk')
    })

    it('registering with an address that has an account tells the owner by mail, whatever the visitor is answered', async () => {
      const owner = unique('registered')
      const to = uniqueAddress(owner)
      await toa(['user', 'create', '--username', owner, '--email', to, '--role', 'subscriber'])
      await env.query(`update setting set value = 'true'::jsonb where key = 'users_can_register'`)
      try {
        // A free username: 202, and the owner gets «you already have an account».
        const visitor = await env.client({ ip: ip() }).register({ username: unique('visitor'), email: to })
        expect(visitor.status).toBe(202)
        const message = await waitForMessage(config(), to)
        expect(message.Text).toContain(owner)
        // A taken username: 409 with a message.
        const taken = await env.client({ ip: ip() }).register({ username: owner, email: `${unique('x')}@example.test` })
        expect(taken.status).toBe(409)
        expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('username_taken')
      } finally {
        await env.query(`update setting set value = 'false'::jsonb where key = 'users_can_register'`)
      }
    })
  },
)
