// The daily clean-up against a real PostgreSQL: each statement does what it says on seeded rows, honours the settings and their
// lower bounds, runs twice without harm, and is bounded. Skips, with a notice, without TEST_DATABASE_URL.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { cleanupCredentials, cleanupIpRetention, cleanupSpamComments } from '../src/jobs/cleanup.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb } from './harness.ts'
import type { JobDb } from './harness.ts'

noticeIfSkipped('worker cleanup')

const NOW = new Date('2026-10-21T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const ago = (days: number, hours = 0): Date => new Date(NOW.getTime() - days * DAY_MS - hours * 60 * 60 * 1000)
const ahead = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS)

describe.skipIf(TEST_DATABASE_URL === undefined)('clean-up jobs (needs TEST_DATABASE_URL)', () => {
  let env: JobDb
  let accountId: string
  let contentId: string
  let counter = 0

  beforeAll(async () => {
    env = await startJobDb()
    const [account] = await env.query<{ id: string }>(
      `insert into account (username, email, display_name, nicename, status)
       values ('cleaner', 'cleaner@example.test', 'cleaner', 'cleaner', 'active') returning id`,
    )
    const [item] = await env.query<{ id: string }>(
      `insert into content (type, locale, slug, status, comment_status)
       values ('post', 'nb', 'p', 'publish', 'open') returning id`,
    )
    if (account === undefined || item === undefined) {
      throw new Error('seed failed')
    }
    accountId = account.id
    contentId = item.id
  })
  afterAll(async () => {
    await env.close()
  })

  beforeEach(async () => {
    await env.query('delete from session')
    await env.query('delete from account_token')
    await env.query('delete from comment')
    await env.query('delete from app_password')
    await env.query('delete from login_attempt')
    // Owner may update; the app role may only insert and read, so the log is reset as the owner.
    await env.query('update audit_log set ip = null')
    await setSetting('ip_retention_days', 90)
    await setSetting('spam_comment_retention_days', 30)
  })

  async function setSetting(key: string, value: unknown): Promise<void> {
    await env.query(
      `insert into setting (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    )
  }

  const run = (job: typeof cleanupCredentials | typeof cleanupIpRetention | typeof cleanupSpamComments) => {
    const { logger, lines } = memoryLogger()
    return job({ db: env.db, logger, now: () => NOW }).then((counts) => ({ counts, lines }))
  }

  async function addSession(expiresAt: Date, createdAt: Date, ip: string | null = '203.0.113.5'): Promise<string> {
    counter += 1
    const [row] = await env.query<{ id: string }>(
      `insert into session (account_id, token_hash, ip, expires_at, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [accountId, `hash-${String(counter)}`, ip, expiresAt, createdAt],
    )
    return row?.id ?? ''
  }

  async function addToken(expiresAt: Date, usedAt: Date | null): Promise<string> {
    counter += 1
    const [row] = await env.query<{ id: string }>(
      `insert into account_token (account_id, purpose, token_hash, expires_at, used_at)
       values ($1, 'password_reset', $2, $3, $4) returning id`,
      [accountId, `token-${String(counter)}`, expiresAt, usedAt],
    )
    return row?.id ?? ''
  }

  async function addComment(status: string, createdAt: Date, modifiedAt: Date, ip: string | null = '198.51.100.9') {
    const [row] = await env.query<{ id: string }>(
      `insert into comment (content_id, author, ip, body, status, created_at, modified_at)
       values ($1, 'a', $2, 'b', $3, $4, $5) returning id`,
      [contentId, ip, status, createdAt, modifiedAt],
    )
    return row?.id ?? ''
  }

  const ids = async (table: string): Promise<string[]> =>
    (await env.query<{ id: string }>(`select id from ${table} order by id`)).map((row) => row.id)

  describe('cleanup.credentials', () => {
    it('deletes ended sessions and keeps live ones', async () => {
      const ended = await addSession(ago(0, 1), ago(3))
      const justEnded = await addSession(ago(0, 0.001), ago(3))
      const live = await addSession(ahead(1), ago(1))
      const longLived = await addSession(ahead(300), ago(100))
      const { counts } = await run(cleanupCredentials)
      expect(counts['sessions']).toBe(2)
      const left = await ids('session')
      expect(left.sort()).toEqual([live, longLived].sort())
      expect(left).not.toContain(ended)
      expect(left).not.toContain(justEnded)
    })

    it('deletes one-time links that are expired or used, and keeps the pending ones', async () => {
      const expired = await addToken(ago(1), null)
      const used = await addToken(ahead(1), ago(0, 2))
      const usedAndExpired = await addToken(ago(2), ago(2, 1))
      const pending = await addToken(ahead(0.5), null)
      const { counts } = await run(cleanupCredentials)
      expect(counts['accountTokens']).toBe(3)
      expect(await ids('account_token')).toEqual([pending])
      expect([expired, used, usedAndExpired]).not.toContain(pending)
    })

    it('is idempotent: a second run finds nothing, and the live rows are untouched', async () => {
      await addSession(ago(1), ago(3))
      const live = await addSession(ahead(1), ago(1))
      await addToken(ago(1), null)
      const first = await run(cleanupCredentials)
      expect(first.counts).toEqual({ sessions: 1, accountTokens: 1, cacheInvalidations: 0 })
      const second = await run(cleanupCredentials)
      expect(second.counts).toEqual({ sessions: 0, accountTokens: 0, cacheInvalidations: 0 })
      expect(await ids('session')).toEqual([live])
    })

    it("deletes the site's cache change log older than a day, and keeps the rest", async () => {
      await env.query(
        `insert into cache_invalidation (tag, changed_at) values ('content:gammel', $1), ('list:post', $2)`,
        [ago(1, 1), ago(0, 23)],
      )
      const { counts } = await run(cleanupCredentials)
      expect(counts['cacheInvalidations']).toBe(1)
      expect((await env.query<{ tag: string }>('select tag from cache_invalidation')).map((row) => row.tag)).toEqual([
        'list:post',
      ])
    })

    it('logs the counts and no ids or addresses', async () => {
      await addSession(ago(1), ago(3), '203.0.113.77')
      const { lines } = await run(cleanupCredentials)
      const done = lines.find((line) => line['msg'] === 'clean-up done')
      expect(done).toMatchObject({ job: 'cleanup.credentials', sessions: 1, accountTokens: 0, failed: [] })
      expect(JSON.stringify(lines)).not.toContain('203.0.113.77')
    })

    it('works on an empty database', async () => {
      expect((await run(cleanupCredentials)).counts).toEqual({ sessions: 0, accountTokens: 0, cacheInvalidations: 0 })
    })

    it('is bounded: a large backlog goes in batches and all of it is deleted', async () => {
      await env.query(
        `insert into session (account_id, token_hash, expires_at, created_at)
         select $1, 'bulk-' || g, $2::timestamptz - interval '1 day', $2::timestamptz - interval '9 days'
         from generate_series(1, 12000) g`,
        [accountId, NOW],
      )
      const live = await addSession(ahead(1), ago(1))
      const { counts } = await run(cleanupCredentials)
      expect(counts['sessions']).toBe(12000)
      expect(await ids('session')).toEqual([live])
    })
  })

  describe('cleanup.ip-retention', () => {
    async function seedOldAndNew(): Promise<{ oldSession: string; newSession: string }> {
      const oldSession = await addSession(ahead(1), ago(100))
      const newSession = await addSession(ahead(1), ago(10))
      return { oldSession, newSession }
    }

    const ipOf = async (table: string, id: string, column = 'ip'): Promise<string | null> =>
      (await env.query<{ ip: string | null }>(`select host(${column}) as ip from ${table} where id = $1`, [id]))[0]
        ?.ip ?? null

    it('blanks the IP of sessions older than the retention, keeps the row, and leaves newer ones alone', async () => {
      const { oldSession, newSession } = await seedOldAndNew()
      const { counts } = await run(cleanupIpRetention)
      expect(counts['sessionIps']).toBe(1)
      expect(await ipOf('session', oldSession)).toBeNull()
      expect(await ipOf('session', newSession)).toBe('203.0.113.5')
      expect(await ids('session')).toHaveLength(2)
    })

    it('blanks the IP of comments but keeps the comment, whatever its status', async () => {
      const old = await addComment('approved', ago(100), ago(100))
      const oldPending = await addComment('pending', ago(95), ago(2))
      const recent = await addComment('approved', ago(10), ago(10))
      const { counts } = await run(cleanupIpRetention)
      expect(counts['commentIps']).toBe(2)
      expect(await ipOf('comment', old)).toBeNull()
      expect(await ipOf('comment', oldPending)).toBeNull()
      expect(await ipOf('comment', recent)).toBe('198.51.100.9')
      expect(await ids('comment')).toHaveLength(3)
    })

    it("does not touch a comment's modified_at (the spam clock) when it blanks the IP", async () => {
      const id = await addComment('spam', ago(100), ago(5))
      await run(cleanupIpRetention)
      const [row] = await env.query<{ modified_at: Date }>('select modified_at from comment where id = $1', [id])
      expect(row?.modified_at.toISOString()).toBe(ago(5).toISOString())
    })

    it('blanks the address an application password was last used from, by when it was last used', async () => {
      const [oldUse] = await env.query<{ id: string }>(
        `insert into app_password (account_id, name, password_hash, last_used_at, last_used_ip, created_at)
         values ($1, 'old', 'h', $2, '203.0.113.1', $3) returning id`,
        [accountId, ago(100), ago(300)],
      )
      const [recentUse] = await env.query<{ id: string }>(
        // Made long ago, used lately: the address is recent.
        `insert into app_password (account_id, name, password_hash, last_used_at, last_used_ip, created_at)
         values ($1, 'recent', 'h', $2, '203.0.113.2', $3) returning id`,
        [accountId, ago(5), ago(300)],
      )
      const [neverUsed] = await env.query<{ id: string }>(
        `insert into app_password (account_id, name, password_hash, created_at) values ($1, 'never', 'h', $2) returning id`,
        [accountId, ago(300)],
      )
      const { counts } = await run(cleanupIpRetention)
      expect(counts['appPasswordIps']).toBe(1)
      expect(await ipOf('app_password', oldUse?.id ?? '', 'last_used_ip')).toBeNull()
      expect(await ipOf('app_password', recentUse?.id ?? '', 'last_used_ip')).toBe('203.0.113.2')
      expect(neverUsed).toBeDefined()
      expect(await ids('app_password')).toHaveLength(3)
    })

    it('deletes login attempts older than the retention and keeps the recent ones', async () => {
      await env.query(
        `insert into login_attempt (action, ip, account_id, created_at) values
         ('login', '203.0.113.1', $1, $2), ('login', '203.0.113.1', null, $3), ('register', '203.0.113.2', null, $4)`,
        [accountId, ago(100), ago(91), ago(1)],
      )
      const { counts } = await run(cleanupIpRetention)
      expect(counts['loginAttempts']).toBe(2)
      const left = await env.query<{ created_at: Date }>('select created_at from login_attempt')
      expect(left.map((row) => row.created_at.toISOString())).toEqual([ago(1).toISOString()])
    })

    it('blanks the IP of old audit log entries through the database function, and keeps the entries', async () => {
      await env.query(
        `insert into audit_log (actor_type, actor, action, source, ip, created_at) values
         ('system', 'test', 'a.old', 'job', '203.0.113.9', now() - interval '100 days'),
         ('system', 'test', 'a.new', 'job', '203.0.113.9', now() - interval '10 days')`,
      )
      const { counts } = await run(cleanupIpRetention)
      expect(counts['auditLogIps']).toBe(1)
      const rows = await env.query<{ action: string; ip: string | null }>(
        "select action, host(ip) as ip from audit_log where action like 'a.%' order by action",
      )
      expect(rows).toEqual([
        { action: 'a.new', ip: '203.0.113.9' },
        { action: 'a.old', ip: null },
      ])
    })

    it('honours ip_retention_days', async () => {
      await setSetting('ip_retention_days', 30)
      const between = await addSession(ahead(1), ago(45))
      const recent = await addSession(ahead(1), ago(10))
      await run(cleanupIpRetention)
      expect(await ipOf('session', between)).toBeNull()
      expect(await ipOf('session', recent)).toBe('203.0.113.5')

      await setSetting('ip_retention_days', 365)
      const veryOld = await addSession(ahead(1), ago(200))
      await run(cleanupIpRetention)
      expect(await ipOf('session', veryOld)).toBe('203.0.113.5')
    })

    it.each([
      ['below the lower bound', 1],
      ['zero', 0],
      ['negative', -5],
    ])('treats a value %s as the lower bound, 7 days: never sooner', async (_name, value) => {
      await setSetting('ip_retention_days', value)
      const eightDays = await addSession(ahead(1), ago(8))
      const sixDays = await addSession(ahead(1), ago(6))
      await env.query(
        `insert into login_attempt (action, ip, created_at) values ('login', '203.0.113.1', $1), ('login', '203.0.113.1', $2)`,
        [ago(8), ago(6)],
      )
      const { counts } = await run(cleanupIpRetention)
      expect(await ipOf('session', eightDays)).toBeNull()
      expect(await ipOf('session', sixDays)).toBe('203.0.113.5')
      expect(counts['loginAttempts']).toBe(1)
    })

    it('treats a value above the upper bound as 3650 days', async () => {
      await setSetting('ip_retention_days', 1_000_000)
      const old = await addSession(ahead(1), ago(3000))
      const veryOld = await addSession(ahead(1), ago(4000))
      await run(cleanupIpRetention)
      expect(await ipOf('session', old)).toBe('203.0.113.5')
      expect(await ipOf('session', veryOld)).toBeNull()
    })

    it.each([
      ['a string', 'forever'],
      ['null', null],
      ['a fraction', 12.5],
      ['an object', { days: 1 }],
    ])('treats %s as the default, 90 days', async (_name, value) => {
      await setSetting('ip_retention_days', value)
      const old = await addSession(ahead(1), ago(100))
      const recent = await addSession(ahead(1), ago(60))
      await run(cleanupIpRetention)
      expect(await ipOf('session', old)).toBeNull()
      expect(await ipOf('session', recent)).toBe('203.0.113.5')
    })

    it('treats a missing setting as 90 days', async () => {
      await env.query("delete from setting where key = 'ip_retention_days'")
      const old = await addSession(ahead(1), ago(100))
      const recent = await addSession(ahead(1), ago(60))
      await run(cleanupIpRetention)
      expect(await ipOf('session', old)).toBeNull()
      expect(await ipOf('session', recent)).toBe('203.0.113.5')
    })

    it('is idempotent', async () => {
      await seedOldAndNew()
      await addComment('approved', ago(100), ago(100))
      await env.query("insert into login_attempt (action, ip, created_at) values ('login', '203.0.113.1', $1)", [
        ago(100),
      ])
      const first = await run(cleanupIpRetention)
      expect(first.counts).toMatchObject({ sessionIps: 1, commentIps: 1, loginAttempts: 1 })
      const second = await run(cleanupIpRetention)
      expect(second.counts).toEqual({
        sessionIps: 0,
        commentIps: 0,
        appPasswordIps: 0,
        loginAttempts: 0,
        auditLogIps: 0,
      })
    })

    it('goes on with the other steps when one fails, and fails the job at the end', async () => {
      // Take the privilege away from the app role for one table; the owner gives it back afterwards.
      await env.query('revoke update on comment from toascribe_app')
      try {
        await seedOldAndNew()
        const { logger, lines } = memoryLogger()
        await expect(cleanupIpRetention({ db: env.db, logger, now: () => NOW })).rejects.toThrow('commentIps failed')
        const ok = lines.find((line) => line['msg'] === 'clean-up done')
        expect(ok).toMatchObject({ failed: ['commentIps'], sessionIps: 1 })
        expect(lines.some((line) => line['msg'] === 'clean-up step failed' && line['step'] === 'commentIps')).toBe(true)
      } finally {
        await env.query('grant select, insert, update, delete on comment to toascribe_app')
      }
    })
  })

  describe('cleanup.spam-comments', () => {
    it('deletes comments marked as spam longer ago than the retention, and no other status', async () => {
      const oldSpam = await addComment('spam', ago(100), ago(40))
      const newSpam = await addComment('spam', ago(100), ago(5))
      const oldApproved = await addComment('approved', ago(100), ago(100))
      const oldTrash = await addComment('trash', ago(100), ago(100))
      const oldPending = await addComment('pending', ago(100), ago(100))
      const { counts } = await run(cleanupSpamComments)
      expect(counts['spamComments']).toBe(1)
      const left = await ids('comment')
      expect(left.sort()).toEqual([newSpam, oldApproved, oldTrash, oldPending].sort())
      expect(left).not.toContain(oldSpam)
    })

    it('honours spam_comment_retention_days', async () => {
      await setSetting('spam_comment_retention_days', 7)
      const tenDays = await addComment('spam', ago(20), ago(10))
      const threeDays = await addComment('spam', ago(20), ago(3))
      await run(cleanupSpamComments)
      expect(await ids('comment')).toEqual([threeDays])
      expect(tenDays).not.toBe(threeDays)
    })

    it.each([
      ['zero', 0, 1],
      ['negative', -3, 1],
      ['above the bound', 100_000, 365],
    ])('treats a value %s as the bound, %i days', async (_name, value, bound) => {
      await setSetting('spam_comment_retention_days', value)
      const inside = await addComment('spam', ago(1000), ago(bound - 0.5))
      const outside = await addComment('spam', ago(1000), ago(bound + 0.5))
      await run(cleanupSpamComments)
      expect(await ids('comment')).toEqual([inside])
      expect(outside).not.toBe(inside)
    })

    it('treats a value that is not a whole number as 30 days', async () => {
      await setSetting('spam_comment_retention_days', 'soon')
      const old = await addComment('spam', ago(100), ago(31))
      const recent = await addComment('spam', ago(100), ago(29))
      await run(cleanupSpamComments)
      expect(await ids('comment')).toEqual([recent])
      expect(old).not.toBe(recent)
    })

    it('leaves the replies of a deleted spam comment standing', async () => {
      const spam = await addComment('spam', ago(100), ago(40))
      const [reply] = await env.query<{ id: string }>(
        `insert into comment (content_id, parent_id, author, body, status) values ($1, $2, 'r', 'b', 'approved') returning id`,
        [contentId, spam],
      )
      await run(cleanupSpamComments)
      const rows = await env.query<{ id: string; parent_id: string | null }>('select id, parent_id from comment')
      expect(rows).toEqual([{ id: reply?.id, parent_id: null }])
    })

    it('is idempotent', async () => {
      await addComment('spam', ago(100), ago(40))
      expect((await run(cleanupSpamComments)).counts).toEqual({ spamComments: 1 })
      expect((await run(cleanupSpamComments)).counts).toEqual({ spamComments: 0 })
    })
  })

  it('runs as the app role, which has plain DML and no more', async () => {
    // The tests above ran through env.db: a statement that needed DDL or owner rights would have failed there.
    const result = await env.db.execute<{ user: string }>(sql`select current_user as user`)
    expect(result.rows[0]?.user).toBe('toascribe_app')
  })
})
