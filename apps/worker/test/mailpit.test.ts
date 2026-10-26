// The e-mail job against a real SMTP server (Mailpit): queue a job as the api does, let the worker send it, read the message
// back. Skips, with a notice, without TEST_DATABASE_URL and MAILPIT_URL + MAILPIT_SMTP.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PGBOSS_APP_OPTIONS, createMailProducer } from '@toascribe/db'
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE, sealEmailMessage } from '@toascribe/shared'
import type { EmailMessage } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { startWorker } from '../src/worker.ts'
import type { Worker } from '../src/worker.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb, testKeyRing } from './harness.ts'
import type { JobDb } from './harness.ts'
import { countMessages, mailpitConfig, noticeIfMailpitSkipped, uniqueAddress, waitForMessage } from './mailpit.ts'

noticeIfSkipped('worker mailpit')
noticeIfMailpitSkipped('worker mailpit')

const mailpit = mailpitConfig()
const ORIGIN = 'https://cms.example.test'
const TOKEN = 'qW3rTy7uIo9pAs2dFg5hJk8lZx1cVb4nMqW3rTy7uIo'

describe.skipIf(TEST_DATABASE_URL === undefined || mailpit === undefined)(
  'e-mail through Mailpit (needs TEST_DATABASE_URL, MAILPIT_URL and MAILPIT_SMTP)',
  () => {
    let env: JobDb
    let worker: Worker
    let producer: PgBoss
    let dir: string
    const log = memoryLogger('trace')
    /** The Mailpit config; the suite only runs when there is one. */
    function m() {
      if (mailpit === undefined) {
        throw new Error('unreachable: the suite is skipped without Mailpit')
      }
      return mailpit
    }

    beforeAll(async () => {
      if (mailpit === undefined) {
        throw new Error('unreachable: the suite is skipped without Mailpit')
      }
      env = await startJobDb()
      dir = await mkdtemp(join(tmpdir(), 'toascribe-worker-mail-'))
      // The sender and the server come from the settings, as they do when an administrator has filled them in.
      await setSetting('smtp_host', mailpit.smtpHost)
      await setSetting('smtp_port', mailpit.smtpPort)
      await setSetting('smtp_secure', 'none')
      await setSetting('mail_from_address', 'noreply@cms.example.test')
      await setSetting('blogname', 'Bloggen på Østlandet')

      worker = await startWorker({
        pool: env.pool,
        db: env.db,
        databaseUrl: env.database.appUrl,
        logger: log.logger,
        heartbeatFile: join(dir, 'heartbeat'),
        uploadsDir: join(dir, 'uploads'),
        keyRing: testKeyRing,
        publicOrigin: ORIGIN,
        mailDefaults: {},
        pollingSeconds: 0.5,
      })
      // The api's side: its own pg-boss, send only.
      producer = new PgBoss({
        ...PGBOSS_APP_OPTIONS,
        connectionString: env.database.appUrl,
        supervise: false,
        schedule: false,
        max: 2,
      })
      producer.on('error', () => undefined)
      await producer.start()
    })

    afterAll(async () => {
      await producer.stop({ graceful: false })
      await worker.stop() // ends env.pool too
      await rm(dir, { recursive: true, force: true })
      await Promise.all([env.owner.end(), env.database.drop()])
    })

    beforeEach(async () => {
      if (mailpit !== undefined) {
        await setSetting('smtp_host', mailpit.smtpHost)
        await setSetting('smtp_port', mailpit.smtpPort)
      }
    })

    async function setSetting(key: string, value: unknown): Promise<void> {
      await env.query(
        `insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`,
        [key, JSON.stringify(value)],
      )
    }

    async function queue(message: EmailMessage, options: Record<string, unknown> = {}): Promise<string> {
      const id = await producer.send(EMAIL_QUEUE, await sealEmailMessage(message, testKeyRing), {
        ...EMAIL_JOB_OPTIONS,
        ...options,
      })
      if (id === null) {
        throw new Error('the job was not queued')
      }
      return id
    }

    async function jobState(id: string) {
      const [job] = await producer.findJobs(EMAIL_QUEUE, { id })
      return { state: job?.state, retryCount: job?.retryCount, output: job?.output }
    }

    async function waitForJob(id: string, states: readonly string[], timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const now = await jobState(id)
        if (now.state !== undefined && states.includes(now.state)) {
          return now
        }
        if (Date.now() > deadline) {
          throw new Error(`job ${id} did not reach ${states.join('/')} (it is ${String(now.state)})`)
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    it('sends a queued lost-password mail: right subject, recipient, sender and bokmål text, with the working link', async () => {
      const to = uniqueAddress('reset')
      const id = await queue({ template: 'password_reset', to, data: { username: 'Åse', token: TOKEN } })
      const message = await waitForMessage(m(), to)

      expect(message.Subject).toBe('[Bloggen på Østlandet] Tilbakestill passordet')
      expect(message.To).toEqual([{ Name: '', Address: to }])
      expect(message.From).toEqual({ Name: 'Bloggen på Østlandet', Address: 'noreply@cms.example.test' })
      expect(message.Text).toContain('Hei Åse,')
      expect(message.Text).toContain(
        'Noen har bedt om å tilbakestille passordet for kontoen din på Bloggen på Østlandet.',
      )
      expect(message.Text).toContain(`${ORIGIN}/admin/login?action=resetpass#token=${TOKEN}`)
      expect(message.HTML).toContain('<html lang="nb">')
      expect(message.HTML).toContain(`href="${ORIGIN}/admin/login?action=resetpass#token=${TOKEN}"`)
      expect((await waitForJob(id, ['completed'])).state).toBe('completed')
    })

    it('never leaves the token readable in the job table, the job output or the log', async () => {
      const to = uniqueAddress('secret')
      const id = await queue({ template: 'set_password', to, data: { username: 'ola', token: TOKEN } })
      // While it waits or after it ran, the stored row has the sealed token and not the real one.
      const rows = await env.query<{ data: unknown; output: unknown }>(
        'select data, output from pgboss.job where id = $1',
        [id],
      )
      expect(JSON.stringify(rows)).not.toContain(TOKEN)
      expect(JSON.stringify(rows)).toContain('"v1:')
      await waitForMessage(m(), to)
      await waitForJob(id, ['completed'])
      const after = await env.query('select data, output from pgboss.job where id = $1', [id])
      expect(JSON.stringify(after)).not.toContain(TOKEN)
      expect(JSON.stringify(log.lines)).not.toContain(TOKEN)
      expect(JSON.stringify(log.lines)).not.toContain(to)
      expect(log.lines.find((line) => line['msg'] === 'e-mail sent' && line['jobId'] === id)).toMatchObject({
        template: 'set_password',
        recipientDomain: 'mailpit.example.test',
      })
    })

    it('sends the admin notice and the test mail, in bokmål', async () => {
      const admin = uniqueAddress('admin')
      await queue({ template: 'admin_new_user', to: admin, data: { username: 'nybruker', email: 'ny@example.test' } })
      const notice = await waitForMessage(m(), admin)
      expect(notice.Subject).toBe('[Bloggen på Østlandet] Ny bruker: nybruker')
      expect(notice.Text).toContain('E-post: ny@example.test')

      const tester = uniqueAddress('test')
      await queue({ template: 'test', to: tester, data: { requestedBy: 'admin' } })
      const test = await waitForMessage(m(), tester)
      expect(test.Subject).toBe('[Bloggen på Østlandet] Test av e-post')
      expect(test.Text).toContain('Når du kan lese den, fungerer utsendingen av e-post.')
    })

    it('sends the notice that `toa user mfa-reset` queues, in bokmål, with the sentence for the action', async () => {
      const to = uniqueAddress('mfareset')
      // Queued by the producer the cli uses (packages/db), not by the test's own pg-boss: the whole path in one test.
      const producer = createMailProducer({
        connectionString: env.database.appUrl,
        applicationName: 'toascribe-cli-test',
        logger: log.logger,
      })
      try {
        const receipt = await producer.sendMail({
          template: 'security_notice',
          to,
          data: { username: 'Åse', action: 'mfa_reset' },
        })
        expect(receipt.jobId).toEqual(expect.any(String))
        const message = await waitForMessage(m(), to)
        expect(message.Subject).toBe('[Bloggen på Østlandet] Sikkerhetsendring på kontoen din')
        expect(message.Text).toContain('Hei Åse,')
        expect(message.Text).toContain(
          'Tofaktor og gjenopprettingskoder er fjernet fra kontoen din av en administrator, og du er logget ut overalt.',
        )
        expect(message.Text).not.toContain('mfa_reset')
        if (receipt.jobId !== null) {
          expect((await waitForJob(receipt.jobId, ['completed'])).state).toBe('completed')
        }
      } finally {
        await producer.stop()
      }
    })

    it('refuses a payload that is not valid when the job is fetched: nothing is sent and it is not retried', async () => {
      const to = uniqueAddress('bad')
      const id = await producer.send(EMAIL_QUEUE, { template: 'newsletter', to, data: { x: 1 } }, EMAIL_JOB_OPTIONS)
      if (id === null) {
        throw new Error('not queued')
      }
      const done = await waitForJob(id, ['failed', 'completed'])
      expect(done).toMatchObject({ state: 'failed', retryCount: 0, output: { error: 'invalid_payload' } })
      expect(await countMessages(m(), to)).toBe(0)
    })

    it('tries again when the server is unreachable, and delivers once it is back', async () => {
      const mp = m()
      await setSetting('smtp_port', 1) // nothing listens there
      const to = uniqueAddress('retry')
      const id = await queue(
        { template: 'test', to, data: { requestedBy: 'admin' } },
        { retryLimit: 5, retryDelay: 1, retryBackoff: true, retryDelayMax: 2 },
      )
      // It fails, and waits for the next try.
      const retrying = await waitForJob(id, ['retry'])
      expect(retrying.state).toBe('retry')
      expect(await countMessages(mp, to)).toBe(0)
      // The server comes back.
      await setSetting('smtp_port', mp.smtpPort)
      const message = await waitForMessage(mp, to)
      expect(message.Subject).toBe('[Bloggen på Østlandet] Test av e-post')
      const done = await waitForJob(id, ['completed'])
      expect(done.retryCount).toBeGreaterThanOrEqual(1)
      expect(
        log.lines.some((line) => line['jobId'] === id && line['msg'] === 'e-mail not sent; it will be tried again'),
      ).toBe(true)
    })
  },
)
