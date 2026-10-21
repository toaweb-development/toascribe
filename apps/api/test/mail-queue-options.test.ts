// How the api constructs pg-boss, checked without a database: the app role may not run DDL, and only the worker supervises and
// schedules (AGENTS.md, «pg-boss»).
import { PGBOSS_APP_OPTIONS } from '@toascribe/db'
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE } from '@toascribe/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryLogger, testKeyRing } from './helpers.ts'

const calls = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  createQueue: [] as unknown[][],
  send: [] as unknown[][],
  stop: [] as unknown[][],
}))

vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor(options: Record<string, unknown>) {
      calls.constructed.push(options)
    }
    on() {
      return this
    }
    start() {
      return Promise.resolve(this)
    }
    createQueue(...args: unknown[]) {
      calls.createQueue.push(args)
      return Promise.resolve()
    }
    send(...args: unknown[]) {
      calls.send.push(args)
      return Promise.resolve('job-1')
    }
    stop(...args: unknown[]) {
      calls.stop.push(args)
      return Promise.resolve()
    }
  },
}))

const { createMailQueue } = await import('../src/adapters/mail-queue.ts')

describe('the api constructs pg-boss as the app role, send only', () => {
  beforeEach(() => {
    calls.constructed.length = 0
    calls.createQueue.length = 0
    calls.send.length = 0
    calls.stop.length = 0
  })

  it('uses PGBOSS_APP_OPTIONS, and neither supervises nor schedules', async () => {
    const queue = createMailQueue({
      connectionString: 'postgres://app:pw@localhost/db',
      keyRing: testKeyRing,
      logger: memoryLogger().logger,
    })
    expect(calls.constructed).toHaveLength(0) // nothing at construction
    await queue.sendMail({ template: 'test', to: 'a@example.test', data: { requestedBy: 'a' } })
    expect(calls.constructed).toHaveLength(1)
    expect(calls.constructed[0]).toMatchObject({
      ...PGBOSS_APP_OPTIONS,
      connectionString: 'postgres://app:pw@localhost/db',
      supervise: false,
      schedule: false,
    })
    expect(PGBOSS_APP_OPTIONS).toMatchObject({
      migrate: false,
      createSchema: false,
      reindex: false,
      persistQueueStats: false,
    })
  })

  it('creates the queue without partitioning, with the job policy, and starts it once for many mails', async () => {
    const queue = createMailQueue({
      connectionString: 'postgres://app:pw@localhost/db',
      keyRing: testKeyRing,
      logger: memoryLogger().logger,
    })
    const message = { template: 'test', to: 'a@example.test', data: { requestedBy: 'a' } } as const
    await Promise.all([queue.sendMail(message), queue.sendMail({ ...message, to: 'b@example.test' })])
    await queue.sendMail({ ...message, to: 'c@example.test' })
    expect(calls.constructed).toHaveLength(1)
    expect(calls.createQueue).toEqual([[EMAIL_QUEUE, EMAIL_JOB_OPTIONS]])
    expect(JSON.stringify(calls.createQueue)).not.toContain('partition')
    expect(calls.send).toHaveLength(3)
    await queue.stop()
    expect(calls.stop).toEqual([[{ graceful: true }]])
  })
})
