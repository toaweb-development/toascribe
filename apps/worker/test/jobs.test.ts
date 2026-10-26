// The worker's registration of queues and schedules, and a clean-up job run through pg-boss itself (not by a direct call), as
// the app role. Needs TEST_DATABASE_URL.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PGBOSS_APP_OPTIONS, createDb } from '@toascribe/db'
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE } from '@toascribe/shared'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CLEANUP_CREDENTIALS, CLEANUP_IP_RETENTION, CLEANUP_JOBS, CLEANUP_SPAM_COMMENTS } from '../src/jobs/cleanup.ts'
import { CONTENT_JOBS, CONTENT_SCHEDULER } from '../src/jobs/content.ts'
import { startWorker } from '../src/worker.ts'
import type { Worker } from '../src/worker.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb, testKeyRing } from './harness.ts'
import type { JobDb } from './harness.ts'

noticeIfSkipped('worker jobs')

describe.skipIf(TEST_DATABASE_URL === undefined)('queues and schedules (needs TEST_DATABASE_URL)', () => {
  let env: JobDb
  let dir: string
  let observer: PgBoss
  const log = memoryLogger('info')

  /** A worker with a pool of its own: stopping it ends that pool, so a second one can be started after. */
  function start(): Promise<Worker> {
    const { db, pool } = createDb({
      connectionString: env.database.appUrl,
      applicationName: 'toascribe-worker-jobs-test',
      max: 4,
    })
    return startWorker({
      pool,
      db,
      databaseUrl: env.database.appUrl,
      logger: log.logger,
      heartbeatFile: join(dir, 'heartbeat'),
      keyRing: testKeyRing,
      publicOrigin: 'https://cms.example.test',
      mailDefaults: {},
      pollingSeconds: 0.5,
    })
  }

  beforeAll(async () => {
    env = await startJobDb()
    dir = await mkdtemp(join(tmpdir(), 'toascribe-worker-jobs-'))
    // A second pg-boss to look from outside: it does not supervise or schedule, as the api does not.
    observer = new PgBoss({
      ...PGBOSS_APP_OPTIONS,
      connectionString: env.database.appUrl,
      supervise: false,
      schedule: false,
      max: 2,
    })
    observer.on('error', () => undefined)
    await observer.start()
  })
  afterAll(async () => {
    await observer.stop({ graceful: false })
    await rm(dir, { recursive: true, force: true })
    await Promise.all([env.pool.end(), env.owner.end()])
    await env.database.drop()
  })

  it('schedules the clean-up jobs and the content jobs (UTC), and a restart does not duplicate them', async () => {
    const read = async () =>
      (await observer.getSchedules())
        .map((s) => ({ name: s.name, cron: s.cron, timezone: s.timezone }))
        .sort((a, b) => a.name.localeCompare(b.name))
    const expected = [...CLEANUP_JOBS, ...CONTENT_JOBS]
      .map((job) => ({ name: job.queue, cron: job.cron, timezone: 'UTC' }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const first = await start()
    expect(await read()).toEqual(expected)
    await first.stop()
    const second = await start()
    expect(await read()).toEqual(expected)
    await second.stop()
    expect(CLEANUP_JOBS.map((job) => job.queue).sort()).toEqual(
      [CLEANUP_CREDENTIALS, CLEANUP_IP_RETENTION, CLEANUP_SPAM_COMMENTS].sort(),
    )
    // Every cron is a daily one in the small hours.
    for (const job of CLEANUP_JOBS) {
      expect(job.cron).toMatch(/^\d{1,2} [0-4] \* \* \*$/)
    }
    // The scheduler runs every minute (K-063); the trash purge daily.
    expect(CONTENT_JOBS.find((job) => job.queue === CONTENT_SCHEDULER)?.cron).toBe('* * * * *')
  })

  it('creates the e-mail queue with the retry and expiry policy, and registers the clean-up queues', async () => {
    const queues = await observer.getQueues()
    const email = queues.find((queue) => queue.name === EMAIL_QUEUE)
    expect(email).toMatchObject({
      retryLimit: EMAIL_JOB_OPTIONS.retryLimit,
      retryDelay: EMAIL_JOB_OPTIONS.retryDelay,
      retryBackoff: true,
      retryDelayMax: EMAIL_JOB_OPTIONS.retryDelayMax,
      expireInSeconds: EMAIL_JOB_OPTIONS.expireInSeconds,
      retentionSeconds: EMAIL_JOB_OPTIONS.retentionSeconds,
      deleteAfterSeconds: EMAIL_JOB_OPTIONS.deleteAfterSeconds,
      partition: false,
    })
    for (const job of [...CLEANUP_JOBS, ...CONTENT_JOBS]) {
      expect(queues.map((queue) => queue.name)).toContain(job.queue)
    }
    expect(queues.find((queue) => queue.name === CONTENT_SCHEDULER)).toMatchObject({
      policy: 'exclusive',
      retryLimit: 0,
    })
    expect(queues.every((queue) => queue.partition === false)).toBe(true)
  })

  it('runs a clean-up job when pg-boss delivers it, as the app role', async () => {
    const { rows } = await env.owner.query<{ id: string }>(
      `insert into account (username, email, display_name, nicename, status)
       values ('queued', 'queued@example.test', 'queued', 'queued', 'active') returning id`,
    )
    const accountId = rows[0]?.id
    await env.owner.query(
      `insert into session (account_id, token_hash, expires_at) values ($1, 'old-one', now() - interval '1 hour'),
                                                                       ($1, 'live-one', now() + interval '1 hour')`,
      [accountId],
    )
    const worker = await start()
    try {
      const id = await observer.send(CLEANUP_CREDENTIALS, null)
      expect(id).not.toBeNull()
      const deadline = Date.now() + 20_000
      while (!log.lines.some((line) => line['msg'] === 'clean-up done' && line['job'] === CLEANUP_CREDENTIALS)) {
        if (Date.now() > deadline) {
          throw new Error('the clean-up job did not run')
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const left = await env.owner.query<{ token_hash: string }>('select token_hash from session')
      expect(left.rows).toEqual([{ token_hash: 'live-one' }])
      expect(log.lines.find((line) => line['msg'] === 'clean-up done')).toMatchObject({
        sessions: 1,
        accountTokens: 0,
        failed: [],
      })
    } finally {
      await worker.stop()
    }
  })
})
