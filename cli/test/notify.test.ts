// `--notify` on the `toa user` commands: which mail is queued for whom, what is stored with it, and what happens when the
// queue is down. The arguments are checked without a database; the rest runs against a real, migrated PostgreSQL. The round
// trip through a worker and Mailpit is in apps/api/test/cli-notify-e2e.test.ts.
import { hashToken, verifyPassword } from '@toascribe/auth'
import { runMigrations } from '@toascribe/db'
import type { MailProducer } from '@toascribe/db'
import { ONE_TIME_LINK_HOURS } from '@toascribe/shared'
import type { EmailMessage } from '@toascribe/shared'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import {
  TEST_DATABASE_URL,
  createTestDatabase,
  memoryLogger,
  noticeIfSkipped,
  query,
  startConnectionProbe,
} from './helpers.ts'
import type { ConnectionProbe, TestDatabase } from './helpers.ts'

noticeIfSkipped('notify')

const VERSION = '1.2.3'
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('--notify: arguments (no database is reached)', () => {
  let probe: ConnectionProbe

  beforeAll(async () => {
    probe = await startConnectionProbe()
  })
  afterAll(async () => {
    await probe.close()
  })

  it('create --notify and --password-stdin exclude each other: a password for the mail is not needed', async () => {
    const before = probe.connections()
    const result = await run(
      [
        'user',
        'create',
        '--username',
        'anna',
        '--email',
        'anna@example.test',
        '--role',
        'editor',
        '--notify',
        '--password-stdin',
      ],
      VERSION,
      { env: { DATABASE_URL: probe.url, TOASCRIBE_ENCRYPTION_KEY: KEY }, readStdin: () => Promise.resolve('x') },
    )
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--notify and --password-stdin exclude each other')
    expect(probe.connections()).toBe(before)
  })

  it('create --notify needs the encryption key, names it and connects to nothing', async () => {
    const before = probe.connections()
    for (const env of [
      { DATABASE_URL: probe.url },
      { DATABASE_URL: probe.url, TOASCRIBE_ENCRYPTION_KEY: 'too-short-secret-value' },
    ]) {
      const result = await run(
        ['user', 'create', '--username', 'anna', '--email', 'anna@example.test', '--role', 'editor', '--notify'],
        VERSION,
        { env },
      )
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('TOASCRIBE_ENCRYPTION_KEY')
      expect(result.stderr).not.toContain('too-short-secret-value')
    }
    expect(probe.connections()).toBe(before)
  })

  it('reset-password and reset-login-limit --notify need no key: a notice carries no token', async () => {
    // The probe drops the connection, so the commands fail at the database, which means they got past the configuration.
    for (const argv of [
      ['user', 'reset-password', '--username', 'anna', '--notify'],
      ['user', 'reset-login-limit', '--username', 'anna', '--notify'],
    ]) {
      const result = await run(argv, VERSION, {
        env: { DATABASE_URL: probe.url },
        logger: memoryLogger().logger,
        readStdin: () => Promise.resolve(''),
      })
      expect(result.stderr).not.toContain('TOASCRIBE_ENCRYPTION_KEY')
      expect(result.stderr).toContain('failed')
    }
  })
})

interface Account {
  id: string
  username: string
  email: string
  status: string
  password_hash: string | null
}

interface TokenRow {
  purpose: string
  token_hash: string
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

describe.skipIf(TEST_DATABASE_URL === undefined)('--notify against PostgreSQL', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase()
    await runMigrations({ connectionString: db.url, logger: pino({ level: 'silent' }) })
  })
  afterAll(async () => {
    await db.drop()
  })

  let counter = 0
  const unique = (base: string) => `${base}${String((counter += 1))}`

  /** A queue that keeps what it is given, or refuses it. */
  function fakeQueue(refuse = false) {
    const sent: EmailMessage[] = []
    const mail: MailProducer = {
      sendMail: (message) => {
        if (refuse) {
          return Promise.reject(new Error(`queue down for ${message.to}`))
        }
        sent.push(message)
        return Promise.resolve({ jobId: `job-${String(sent.length)}` })
      },
      stop: () => Promise.resolve(),
    }
    return { sent, mail }
  }

  async function toa(
    argv: readonly string[],
    options: { mail?: MailProducer; env?: Record<string, string>; stdin?: string } = {},
  ) {
    const log = memoryLogger()
    const result = await run(argv, VERSION, {
      env: { DATABASE_URL: db.url, NODE_ENV: 'production', ...options.env },
      logger: log.logger,
      readStdin: () => Promise.resolve(options.stdin ?? ''),
      ...(options.mail === undefined ? {} : { mail: options.mail }),
    })
    return { ...result, ...log }
  }

  const accountOf = async (username: string): Promise<Account | undefined> =>
    (await query<Account>(db.url, 'select * from account where lower(username) = lower($1)', [username]))[0]

  const tokensOf = (accountId: string) =>
    query<TokenRow>(db.url, 'select * from account_token where account_id = $1 order by created_at', [accountId])

  const auditOf = (accountId: string) =>
    query<{ action: string; new_value: unknown }>(
      db.url,
      'select action, new_value from audit_log where object_id = $1 order by created_at',
      [accountId],
    )

  const createArgs = (username: string, role = 'editor') =>
    ['user', 'create', '--username', username, '--email', `${username}@example.test`, '--role', role] as const

  const jobsTo = (to: string) =>
    query<{ data: Record<string, unknown> }>(
      db.url,
      `select data from pgboss.job where name = 'email.send' and data->>'to' = $1`,
      [to],
    )

  describe('user create --notify', () => {
    it('makes a pending account with no password and mails a one-time link to choose one', async () => {
      const username = unique('welcome')
      const queue = fakeQueue()
      const started = Date.now()
      const result = await toa([...createArgs(username, 'author'), '--notify'], { mail: queue.mail })
      expect(result.code).toBe(0)
      // Nothing to print: there is no password.
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('no password yet')
      expect(result.stderr).toContain(`valid ${String(ONE_TIME_LINK_HOURS)} hours`)

      const account = await accountOf(username)
      expect(account).toMatchObject({ status: 'pending', password_hash: null })

      expect(queue.sent).toHaveLength(1)
      const message = queue.sent[0]
      expect(message).toMatchObject({
        template: 'set_password',
        to: `${username}@example.test`,
        data: { username },
      })
      const token = message !== undefined && 'token' in message.data ? message.data.token : ''
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

      // The row is what the api's `set_password` flow wants: that purpose, only the hash, 24 hours, unused.
      const rows = await tokensOf(account?.id ?? '')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ purpose: 'set_password', token_hash: hashToken(token), used_at: null })
      const lifetime = (rows[0]?.expires_at.getTime() ?? 0) - (rows[0]?.created_at.getTime() ?? 0)
      expect(lifetime).toBe(ONE_TIME_LINK_HOURS * 60 * 60 * 1000)
      expect(rows[0]?.created_at.getTime()).toBeGreaterThanOrEqual(started - 1000)

      expect((await auditOf(account?.id ?? '')).find((row) => row.action === 'account.created')).toMatchObject({
        new_value: { role: 'author', welcomeMail: true },
      })
      // The token is in the mail and nowhere else.
      expect(JSON.stringify([result, await query(db.url, 'select * from audit_log')])).not.toContain(token)
    })

    it('without --notify nothing is mailed and the account has its password at once, as before', async () => {
      const username = unique('plain')
      const queue = fakeQueue()
      const result = await toa(createArgs(username), { mail: queue.mail })
      expect(result.code).toBe(0)
      expect(queue.sent).toEqual([])
      const account = await accountOf(username)
      expect(account?.status).toBe('active')
      expect((await verifyPassword(result.stdout.trim(), account?.password_hash ?? '')).valid).toBe(true)
      expect(await tokensOf(account?.id ?? '')).toEqual([])
    })

    it('refuses a taken name before anything is mailed', async () => {
      const username = unique('taken')
      await toa(createArgs(username), {})
      const queue = fakeQueue()
      const result = await toa([...createArgs(username), '--notify'], { mail: queue.mail })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('--username: an account already has that username')
      expect(queue.sent).toEqual([])
    })

    it('keeps the account and says how to get a new link when the mail cannot be queued, without the address', async () => {
      const username = unique('queuedown')
      const queue = fakeQueue(true)
      const result = await toa([...createArgs(username), '--notify'], { mail: queue.mail })
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('could not be queued')
      expect(result.stderr).toContain('Lost your password?')
      expect(result.stderr).not.toContain(`${username}@example.test`)
      expect((await accountOf(username))?.status).toBe('pending')
    })

    it('through the real queue the token is sealed: the job holds no working link', async () => {
      const username = unique('sealed')
      const result = await toa([...createArgs(username), '--notify'], { env: { TOASCRIBE_ENCRYPTION_KEY: KEY } })
      expect(result.code).toBe(0)
      const jobs = await jobsTo(`${username}@example.test`)
      expect(jobs).toHaveLength(1)
      const data = jobs[0]?.data as { template: string; data: { token: string; username: string } }
      expect(data.template).toBe('set_password')
      expect(data.data.token).toMatch(/^v1:/)
      const account = await accountOf(username)
      const rows = await tokensOf(account?.id ?? '')
      // Not the token itself, and not its hash either.
      expect(JSON.stringify(jobs)).not.toContain(rows[0]?.token_hash ?? 'x')
    })
  })

  describe('user reset-password --notify', () => {
    async function victim(base: string) {
      const username = unique(base)
      const made = await toa(createArgs(username))
      expect(made.code).toBe(0)
      return { username, email: `${username}@example.test` }
    }

    it('queues a security notice that says an administrator changed the password, with no password in it', async () => {
      const who = await victim('resetnotify')
      const queue = fakeQueue()
      const result = await toa(['user', 'reset-password', '--username', who.username, '--notify'], { mail: queue.mail })
      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^\S{24}\n$/)
      expect(result.stderr).toContain('A security notice is queued')
      expect(queue.sent).toEqual([
        {
          template: 'security_notice',
          to: who.email,
          data: { username: who.username, action: 'password_reset_by_admin' },
        },
      ])
      expect(JSON.stringify(queue.sent)).not.toContain(result.stdout.trim())
    })

    it('mails the account found by e-mail address, to its own address', async () => {
      const who = await victim('resetnotify-mail')
      const queue = fakeQueue()
      await toa(['user', 'reset-password', '--email', who.email.toUpperCase(), '--notify'], { mail: queue.mail })
      expect(queue.sent.map((message) => message.to)).toEqual([who.email])
    })

    it('sends nothing without --notify, and nothing for an account that does not exist', async () => {
      const who = await victim('resetquiet')
      const queue = fakeQueue()
      expect((await toa(['user', 'reset-password', '--username', who.username], { mail: queue.mail })).code).toBe(0)
      const missing = await toa(['user', 'reset-password', '--username', 'nobodyhere', '--notify'], {
        mail: queue.mail,
      })
      expect(missing.code).toBe(1)
      expect(queue.sent).toEqual([])
    })

    it('prints the new password all the same when the notice cannot be queued, and exits 1', async () => {
      const who = await victim('resetdown')
      const before = (await accountOf(who.username))?.password_hash
      const queue = fakeQueue(true)
      const result = await toa(['user', 'reset-password', '--username', who.username, '--notify'], { mail: queue.mail })
      expect(result.code).toBe(1)
      expect(result.stdout).toMatch(/^\S{24}\n$/)
      expect(result.stderr).toContain('could not be queued')
      const after = (await accountOf(who.username))?.password_hash
      expect(after).not.toBe(before)
      expect((await verifyPassword(result.stdout.trim(), after ?? '')).valid).toBe(true)
      expect(result.stderr).not.toContain(who.email)
    })
  })

  describe('user reset-login-limit --notify', () => {
    it('queues a short notice and nothing else', async () => {
      const username = unique('limitnotify')
      await toa(createArgs(username))
      const queue = fakeQueue()
      const result = await toa(['user', 'reset-login-limit', '--username', username, '--notify'], { mail: queue.mail })
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('A notice is queued')
      expect(queue.sent).toEqual([
        {
          template: 'security_notice',
          to: `${username}@example.test`,
          data: { username, action: 'login_limit_reset' },
        },
      ])
    })

    it('sends nothing without --notify; exits 1 and says the wait is ended when the queue is down', async () => {
      const username = unique('limitquiet')
      await toa(createArgs(username))
      const quiet = fakeQueue()
      expect((await toa(['user', 'reset-login-limit', '--username', username], { mail: quiet.mail })).code).toBe(0)
      expect(quiet.sent).toEqual([])

      const down = fakeQueue(true)
      const result = await toa(['user', 'reset-login-limit', '--username', username, '--notify'], { mail: down.mail })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Ended the wait after failed attempts')
      expect(result.stderr).toContain('could not be queued')
    })
  })

  describe('user mfa-reset', () => {
    it('always notifies; --notify changes nothing', async () => {
      for (const extra of [[], ['--notify']]) {
        const username = unique('mfa')
        await toa(createArgs(username))
        const queue = fakeQueue()
        const result = await toa(['user', 'mfa-reset', '--username', username, ...extra], { mail: queue.mail })
        expect(result.code).toBe(0)
        expect(queue.sent).toEqual([
          {
            template: 'security_notice',
            to: `${username}@example.test`,
            data: { username, action: 'mfa_reset' },
          },
        ])
      }
    })
  })
})
