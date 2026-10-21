// The api's producer of the `email.send` job against a real PostgreSQL: what is stored, how it is retried, and what is refused.
// No worker runs here, so the jobs stay queued and can be read back. Needs TEST_DATABASE_URL.
import { runMigrations } from '@toascribe/db'
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE, EmailJobPayload } from '@toascribe/shared'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createMailQueue } from '../src/adapters/mail-queue.ts'
import type { MailQueue } from '../src/adapters/mail-queue.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './db.ts'
import type { TestDatabase } from './db.ts'
import { UNREACHABLE_DATABASE_URL, memoryLogger, testKeyRing } from './helpers.ts'

noticeIfSkipped('mail-queue')

const TOKEN = 'rJ3x9Qm2LkP7vN4sT8uYb1CdEfGhIjKlMnOpQrStUvW'

interface JobRow {
  id: string
  name: string
  data: unknown
  state: string
  retry_limit: number
  retry_delay: number
  retry_backoff: boolean
  retry_delay_max: number | null
  expire_seconds: number
  singleton_key: string | null
  singleton_on: Date | null
  keep_until: Date
  created_on: Date
}

describe.skipIf(TEST_DATABASE_URL === undefined)('the e-mail producer (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let owner: pg.Pool
  let queue: MailQueue
  const log = memoryLogger()

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })
    owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    queue = createMailQueue({ connectionString: database.appUrl, keyRing: testKeyRing, logger: log.logger })
  })
  afterAll(async () => {
    await queue.stop()
    await owner.end()
    await database.drop()
  })
  beforeEach(async () => {
    log.lines.length = 0
    await owner.query("delete from pgboss.job where name = 'email.send'")
  })

  const jobs = async (): Promise<JobRow[]> =>
    (await owner.query<JobRow>("select * from pgboss.job where name = 'email.send' order by created_on")).rows

  it('queues a message on the email.send queue, with the retry, backoff and expiry policy', async () => {
    const receipt = await queue.sendMail({
      template: 'test',
      to: 'admin@example.test',
      data: { requestedBy: 'admin' },
    })
    expect(receipt.jobId).toEqual(expect.any(String))
    const [job] = await jobs()
    expect(job).toMatchObject({
      id: receipt.jobId,
      name: EMAIL_QUEUE,
      state: 'created',
      retry_limit: EMAIL_JOB_OPTIONS.retryLimit,
      retry_delay: EMAIL_JOB_OPTIONS.retryDelay,
      retry_backoff: true,
      retry_delay_max: EMAIL_JOB_OPTIONS.retryDelayMax,
      expire_seconds: EMAIL_JOB_OPTIONS.expireInSeconds,
    })
    // A mail still waiting after the retention is dropped: the job expires at that moment.
    const lifetimeSeconds = ((job?.keep_until.getTime() ?? 0) - (job?.created_on.getTime() ?? 0)) / 1000
    expect(Math.round(lifetimeSeconds)).toBe(EMAIL_JOB_OPTIONS.retentionSeconds)
    expect(job?.data).toEqual({ template: 'test', to: 'admin@example.test', data: { requestedBy: 'admin' } })
  })

  it('stores the one-time token encrypted, in a payload the worker accepts, and never in plain text', async () => {
    await queue.sendMail({
      template: 'password_reset',
      to: 'kari@example.no',
      data: { username: 'kari', token: TOKEN },
    })
    const [job] = await jobs()
    expect(JSON.stringify(job)).not.toContain(TOKEN)
    const payload = EmailJobPayload.parse(job?.data)
    expect(payload).toMatchObject({ template: 'password_reset', to: 'kari@example.no', data: { username: 'kari' } })
    if (!('token' in payload.data)) {
      throw new Error('no token in the payload')
    }
    expect(payload.data.token).toMatch(/^v1:/)
    // Bound to the template and the recipient.
    await expect(
      testKeyRing.decrypt(payload.data.token, 'email.send:token:password_reset:kari@example.no'),
    ).resolves.toBe(TOKEN)
    await expect(
      testKeyRing.decrypt(payload.data.token, 'email.send:token:password_reset:ola@example.no'),
    ).rejects.toThrow()
  })

  it('logs the job id, the template and the recipient domain, and nothing else', async () => {
    const receipt = await queue.sendMail({
      template: 'password_reset',
      to: 'kari.nordmann@example.no',
      data: { username: 'kari', token: TOKEN },
    })
    const line = log.lines.find((l) => l['msg'] === 'e-mail queued')
    expect(line).toMatchObject({ jobId: receipt.jobId, template: 'password_reset', recipientDomain: 'example.no' })
    const text = JSON.stringify(log.lines)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('kari.nordmann')
    expect(text).not.toContain('"kari"')
  })

  describe('refuses a message that is not valid, before anything is queued', () => {
    it.each([
      ['an unknown template', { template: 'newsletter', to: 'a@example.test', data: {} }],
      ['a recipient that is not an address', { template: 'test', to: 'nope', data: { requestedBy: 'a' } }],
      [
        'a header injection in the recipient',
        { template: 'test', to: 'a@example.test\r\nBcc: x@example.test', data: { requestedBy: 'a' } },
      ],
      ['a missing token', { template: 'password_reset', to: 'a@example.test', data: { username: 'kari' } }],
      [
        'a token that is too short',
        { template: 'password_reset', to: 'a@example.test', data: { username: 'kari', token: 'abc' } },
      ],
      [
        'a field the template does not take',
        { template: 'test', to: 'a@example.test', data: { requestedBy: 'a', cc: 'b' } },
      ],
      ['a name with a line break', { template: 'test', to: 'a@example.test', data: { requestedBy: 'a\nb' } }],
    ])('%s', async (_name, message) => {
      // The port is typed, so the test goes round the types the way a bug or a JSON file could.
      const send = queue.sendMail.bind(queue) as (m: unknown) => Promise<unknown>
      const error = await send(message).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/^Invalid e-mail message: /)
      expect((error as Error).message).not.toContain('a@example.test')
      expect(await jobs()).toHaveLength(0)
    })
  })

  describe('the same message twice', () => {
    const message = {
      template: 'admin_new_user',
      to: 'admin@example.test',
      data: { username: 'ola', email: 'ola@example.test' },
    } as const

    it('is queued once: the second is dropped by the queue and reports no job', async () => {
      const first = await queue.sendMail(message)
      const second = await queue.sendMail(message)
      expect(first.jobId).not.toBeNull()
      expect(second.jobId).toBeNull()
      expect(await jobs()).toHaveLength(1)
      expect(log.lines.some((l) => l['msg'] === 'e-mail not queued: duplicate or throttled')).toBe(true)
    })

    it('treats another recipient, other data, or another token as a different message', async () => {
      await queue.sendMail(message)
      await queue.sendMail({ ...message, to: 'second.admin@example.test' })
      await queue.sendMail({ ...message, data: { username: 'kari', email: 'kari@example.test' } })
      await queue.sendMail({
        template: 'password_reset',
        to: 'kari@example.no',
        data: { username: 'kari', token: TOKEN },
      })
      await queue.sendMail({
        template: 'password_reset',
        to: 'kari@example.no',
        data: { username: 'kari', token: `${TOKEN.slice(0, -1)}X` },
      })
      expect(await jobs()).toHaveLength(5)
    })

    it('ignores the case of the address and the order of the data', async () => {
      await queue.sendMail(message)
      const again = await queue.sendMail({
        ...message,
        to: 'Admin@Example.TEST',
        data: { email: 'ola@example.test', username: 'ola' },
      })
      expect(again.jobId).toBeNull()
    })

    it('keeps no readable form of the message in the key', async () => {
      await queue.sendMail({
        template: 'password_reset',
        to: 'kari@example.no',
        data: { username: 'kari', token: TOKEN },
      })
      const [job] = await jobs()
      expect(job?.singleton_key).toMatch(/^email\.[0-9a-f]{64}$/)
      expect(job?.singleton_key).not.toContain(TOKEN)
    })
  })

  it('honours a throttle: one mail per key per window, and another key is free', async () => {
    const message = { template: 'test', to: 'admin@example.test', data: { requestedBy: 'admin' } } as const
    const throttle = { key: 'test-email.account-one', seconds: 30 }
    expect((await queue.sendMail(message, { throttle })).jobId).not.toBeNull()
    // Even a different message under the same key is held back: the key is the rule.
    expect((await queue.sendMail({ ...message, to: 'other@example.test' }, { throttle })).jobId).toBeNull()
    expect(
      (await queue.sendMail(message, { throttle: { ...throttle, key: 'test-email.account-two' } })).jobId,
    ).not.toBeNull()
    expect(await jobs()).toHaveLength(2)
  })

  it('creates the queue itself (the worker may not have started yet), and does it without DDL rights', async () => {
    const fresh = createMailQueue({ connectionString: database.appUrl, keyRing: testKeyRing, logger: log.logger })
    try {
      await owner.query("delete from pgboss.queue where name = 'email.send'")
      expect(
        (await fresh.sendMail({ template: 'test', to: 'a@example.test', data: { requestedBy: 'a' } })).jobId,
      ).not.toBeNull()
      const { rows } = await owner.query<{ partition: boolean; retry_limit: number }>(
        "select partition, retry_limit from pgboss.queue where name = 'email.send'",
      )
      expect(rows).toEqual([{ partition: false, retry_limit: EMAIL_JOB_OPTIONS.retryLimit }])
    } finally {
      await fresh.stop()
    }
  })

  describe('when the queue cannot be reached', () => {
    it('starts nothing at construction, and fails the mail with an error rather than hanging or crashing', async () => {
      const broken = createMailQueue({
        connectionString: UNREACHABLE_DATABASE_URL,
        keyRing: testKeyRing,
        logger: log.logger,
      })
      await expect(
        broken.sendMail({ template: 'test', to: 'a@example.test', data: { requestedBy: 'a' } }),
      ).rejects.toThrow()
      // And the next mail tries again instead of remembering the failure.
      await expect(
        broken.sendMail({ template: 'test', to: 'a@example.test', data: { requestedBy: 'a' } }),
      ).rejects.toThrow()
      await broken.stop()
    })

    it('stop() is harmless when nothing was started, and when called twice', async () => {
      const idle = createMailQueue({
        connectionString: UNREACHABLE_DATABASE_URL,
        keyRing: testKeyRing,
        logger: log.logger,
      })
      await idle.stop()
      await idle.stop()
    })
  })
})
