// `toa user create` and `toa user reset-password`: the arguments and the refusals (no database needed) and the commands
// themselves against a real, migrated PostgreSQL (TEST_DATABASE_URL).
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { verifyPassword } from '@toascribe/auth'
import { runMigrations } from '@toascribe/db'
import { BUILT_IN_ROLES } from '@toascribe/shared'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run, USAGE } from '../src/run.ts'
import {
  TEST_DATABASE_URL,
  createTestDatabase,
  memoryLogger,
  noticeIfSkipped,
  query,
  startConnectionProbe,
} from './helpers.ts'
import type { ConnectionProbe, TestDatabase } from './helpers.ts'

noticeIfSkipped('user')

const VERSION = '1.2.3'
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const GOOD_PASSWORD = 'correct horse battery staple'

interface Account {
  id: string
  username: string
  email: string
  display_name: string
  nicename: string
  status: string
  password_hash: string | null
}

describe('arguments (no database is reached)', () => {
  let probe: ConnectionProbe

  beforeAll(async () => {
    probe = await startConnectionProbe()
  })
  afterAll(async () => {
    await probe.close()
  })

  async function refused(argv: readonly string[], stdin = '') {
    const before = probe.connections()
    const log = memoryLogger()
    const result = await run(argv, VERSION, {
      env: { DATABASE_URL: probe.url },
      logger: log.logger,
      readStdin: () => Promise.resolve(stdin),
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(probe.connections()).toBe(before)
    expect(log.lines).toEqual([])
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('probe-secret-pw')
    return result
  }

  const create = ['user', 'create', '--username', 'anna', '--email', 'anna@example.test', '--role', 'editor'] as const

  it('names the commands in the usage text', () => {
    expect(USAGE).toContain('user create --username')
    expect(USAGE).toContain('user reset-password')
    expect(USAGE).toContain('user reset-login-limit')
    expect(USAGE).toContain('user mfa-reset (--username <name> | --email <address>) [--notify]')
    expect(USAGE).toContain('--password-stdin')
    expect(USAGE).toContain('DATABASE_URL')
  })

  it.each([
    ['username', ['user', 'create', '--email', 'a@example.test', '--role', 'editor'], '--username is required'],
    ['email', ['user', 'create', '--username', 'anna', '--role', 'editor'], '--email is required'],
    ['role', ['user', 'create', '--username', 'anna', '--email', 'a@example.test'], '--role is required'],
  ])('create without --%s exits 2 and says so', async (_flag, argv, message) => {
    const result = await refused(argv)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain('Usage:')
  })

  it('create refuses a bad username, e-mail address and display name by flag, without echoing the values', async () => {
    const result = await refused([
      'user',
      'create',
      '--username',
      'bad name!',
      '--email',
      'not an address',
      '--role',
      'editor',
      '--display-name',
      'two\nlines',
    ])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--username:')
    expect(result.stderr).toContain('--email:')
    expect(result.stderr).toContain('--display-name:')
    for (const value of ['bad name!', 'not an address', 'two\nlines']) {
      expect(result.stderr).not.toContain(value)
    }
  })

  it('never takes a password from the command line, and does not echo it', async () => {
    for (const argv of [
      [...create, '--password', 'hunter2hunter2'],
      [...create, '--password=hunter2hunter2'],
      [...create, 'hunter2hunter2'],
    ]) {
      const result = await refused(argv)
      expect(result.code).toBe(2)
      expect(result.stderr).not.toContain('hunter2')
    }
    expect((await refused([...create, '--password', 'hunter2hunter2'])).stderr).toContain('--password-stdin')
  })

  it('refuses unknown options by name, a flag without a value and a flag that takes none', async () => {
    expect((await refused([...create, '--frobnicate'])).stderr).toContain('Unknown option --frobnicate')
    expect(
      (await refused(['user', 'create', '--username', '--email', 'a@example.test', '--role', 'x'])).stderr,
    ).toContain('--username needs a value')
    expect((await refused([...create, '--password-stdin=yes'])).stderr).toContain('--password-stdin takes no value')
  })

  it('refuses a password from standard input that is too short, empty or equal to the address, without echoing it', async () => {
    for (const [stdin, text] of [
      ['short\n', 'Too small'],
      ['', 'Too small'],
      ['\n', 'Too small'],
      ['anna@example.test\n', 'must not be the username or the e-mail address'],
    ] as const) {
      const result = await refused([...create, '--password-stdin'], stdin)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain(text)
      expect(result.stderr).not.toContain('short')
    }
  })

  it('reset-password needs exactly one of --username and --email', async () => {
    for (const argv of [
      ['user', 'reset-password'],
      ['user', 'reset-password', '--username', 'anna', '--email', 'a@example.test'],
    ]) {
      const result = await refused(argv)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('exactly one of --username and --email')
    }
  })

  it('reset-login-limit needs exactly one of --username and --email, and no other option', async () => {
    for (const argv of [
      ['user', 'reset-login-limit'],
      ['user', 'reset-login-limit', '--username', 'anna', '--email', 'a@example.test'],
    ]) {
      const result = await refused(argv)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('exactly one of --username and --email')
    }
    const extra = await refused(['user', 'reset-login-limit', '--username', 'anna', '--password-stdin'])
    expect(extra.code).toBe(2)
    expect(extra.stderr).toContain('Unknown option --password-stdin')
  })

  it('mfa-reset needs exactly one of --username and --email, and no other option', async () => {
    for (const argv of [
      ['user', 'mfa-reset'],
      ['user', 'mfa-reset', '--username', 'anna', '--email', 'a@example.test'],
    ]) {
      const result = await refused(argv)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('exactly one of --username and --email')
      expect(result.stderr).toContain('user mfa-reset')
    }
    const extra = await refused(['user', 'mfa-reset', '--username', 'anna', '--password-stdin'])
    expect(extra.code).toBe(2)
    expect(extra.stderr).toContain('Unknown option --password-stdin')
    const valued = await refused(['user', 'mfa-reset', '--username', 'anna', '--notify', 'yes'])
    expect(valued.code).toBe(2)
  })

  it('does not need NODE_ENV: there is no guard, the commands work in production', async () => {
    const log = memoryLogger()
    const result = await run([...create], VERSION, {
      env: { NODE_ENV: 'production', DATABASE_URL: probe.url },
      logger: log.logger,
    })
    expect(result.stderr).not.toContain('Refusing')
    expect(result.stderr).toBe('user create failed; see the log above\n')
    expect(probe.connections()).toBeGreaterThan(0)
  })

  it('on a failed connection logs no query text, e-mail address, hash or password', async () => {
    const log = memoryLogger()
    const result = await run([...create, '--password-stdin'], VERSION, {
      env: { DATABASE_URL: probe.url },
      logger: log.logger,
      readStdin: () => Promise.resolve(`${GOOD_PASSWORD}\n`),
    })
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'user create failed; see the log above\n' })
    const everything = JSON.stringify(log.lines)
    expect(log.lines.length).toBeGreaterThan(0)
    for (const secret of [GOOD_PASSWORD, 'anna@example.test', '$argon2id', 'probe-secret-pw', 'insert into']) {
      expect(everything).not.toContain(secret)
    }
  })

  it('names DATABASE_URL, never its value, when it is missing or not a postgres URL; MIGRATION_DATABASE_URL does not stand in', async () => {
    const missing = await run([...create], VERSION, { env: { MIGRATION_DATABASE_URL: probe.url } })
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('DATABASE_URL')

    const bad = await run(['user', 'reset-password', '--username', 'anna'], VERSION, {
      env: { DATABASE_URL: 'mysql://u:hunter2@h/db' },
    })
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('DATABASE_URL')
    expect(bad.stderr).not.toContain('hunter2')
  })

  it('exits 2 with the usage for an unknown user subcommand', async () => {
    expect(await run(['user'], VERSION)).toEqual({ code: 2, stdout: '', stderr: USAGE })
    expect(await run(['user', 'delete'], VERSION)).toEqual({ code: 2, stdout: '', stderr: USAGE })
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('toa user against PostgreSQL', () => {
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

  async function toa(argv: readonly string[], stdin?: string, env: Record<string, string> = {}) {
    const log = memoryLogger()
    const result = await run(argv, VERSION, {
      env: { DATABASE_URL: db.url, NODE_ENV: 'production', ...env },
      logger: log.logger,
      ...(stdin === undefined ? {} : { readStdin: () => Promise.resolve(stdin) }),
    })
    return { ...result, ...log }
  }

  const createArgs = (username: string, role: string, email = `${username}@example.test`) =>
    ['user', 'create', '--username', username, '--email', email, '--role', role] as const

  const accountOf = async (username: string): Promise<Account | undefined> =>
    (await query<Account>(db.url, 'select * from account where lower(username) = lower($1)', [username]))[0]

  const auditOf = (accountId: string) =>
    query<{
      actor_type: string
      actor: string
      source: string
      action: string
      account_id: string | null
      object_id: string
      new_value: unknown
      ip: string | null
    }>(db.url, 'select * from audit_log where object_id = $1 order by created_at', [accountId])

  const rolesOf = async (accountId: string) =>
    (
      await query<{ slug: string }>(
        db.url,
        'select r.slug from account_role ar join role r on r.id = ar.role_id where ar.account_id = $1',
        [accountId],
      )
    ).map((row) => row.slug)

  describe('user create', () => {
    it.each(BUILT_IN_ROLES)('creates an active account with the role %s and a generated password', async (slug) => {
      const username = unique(`made-${slug}-`)
      const result = await toa(createArgs(username, slug))
      expect(result.code).toBe(0)

      const account = await accountOf(username)
      expect(account).toMatchObject({
        username,
        email: `${username}@example.test`,
        display_name: username,
        nicename: username.toLowerCase(),
        status: 'active',
      })
      expect(await rolesOf(account?.id ?? '')).toEqual([slug])

      // The generated password is on stdout, alone, and is the one that was hashed.
      const printed = result.stdout.split('\n')
      expect(printed).toHaveLength(2)
      expect(printed[1]).toBe('')
      expect(printed[0]).toHaveLength(24)
      expect(account?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
      expect(await verifyPassword(printed[0] ?? '', account?.password_hash ?? '')).toEqual({
        valid: true,
        needsRehash: false,
      })
      expect(result.stderr).toContain(`"${username}"`)
      expect(result.stderr).not.toContain(printed[0])
    })

    it('writes an audit entry: system actor cli, source cli, the account and the role, no address', async () => {
      const username = unique('audited')
      await toa(createArgs(username, 'author'))
      const account = await accountOf(username)
      const entries = await auditOf(account?.id ?? '')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actor_type: 'system',
        actor: 'cli',
        source: 'cli',
        action: 'account.created',
        account_id: account?.id,
        new_value: { role: 'author' },
        ip: null,
      })
    })

    it('prints a generated password once and logs it nowhere', async () => {
      const username = unique('quiet')
      const result = await toa(createArgs(username, 'editor'))
      const password = result.stdout.trim()
      const account = await accountOf(username)
      expect(password).toHaveLength(24)
      expect(result.stdout.split(password)).toHaveLength(2) // exactly once
      expect(result.stderr).not.toContain(password)
      expect(result.lines.length).toBeGreaterThan(0)
      const logged = JSON.stringify(result.lines)
      expect(logged).not.toContain(password)
      expect(logged).not.toContain(account?.password_hash ?? 'x')
      expect(logged).not.toContain(`${username}@example.test`)
      expect(result.lines.find((line) => line['msg'] === 'account created')).toMatchObject({
        accountId: account?.id,
        role: 'editor',
      })
    })

    it('makes a different password each time', async () => {
      const a = await toa(createArgs(unique('gena'), 'subscriber'))
      const b = await toa(createArgs(unique('genb'), 'subscriber'))
      expect(a.stdout).not.toBe(b.stdout)
    })

    it('uses the password from standard input, prints nothing on stdout, and takes off only one line break', async () => {
      for (const [stdin, stored] of [
        [`${GOOD_PASSWORD}\n`, GOOD_PASSWORD],
        [`${GOOD_PASSWORD}\r\n`, GOOD_PASSWORD],
        [GOOD_PASSWORD, GOOD_PASSWORD],
        [` ${GOOD_PASSWORD} \n`, ` ${GOOD_PASSWORD} `],
        [`${GOOD_PASSWORD}\n\n`, `${GOOD_PASSWORD}\n`],
      ] as const) {
        const username = unique('stdin')
        const result = await toa([...createArgs(username, 'administrator'), '--password-stdin'], stdin)
        expect(result.code).toBe(0)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain(`"${username}"`)
        expect(JSON.stringify(result.lines)).not.toContain(GOOD_PASSWORD)
        const account = await accountOf(username)
        expect((await verifyPassword(stored, account?.password_hash ?? '')).valid).toBe(true)
        expect((await verifyPassword('something else', account?.password_hash ?? '')).valid).toBe(false)
      }
    })

    it('uses --display-name, and the username when it is left out', async () => {
      const named = unique('named')
      await toa([...createArgs(named, 'editor'), '--display-name', '  Anna Larsen  '])
      expect((await accountOf(named))?.display_name).toBe('Anna Larsen')
    })

    it('gives the author URL name a free variant when another account has it', async () => {
      const first = await toa(createArgs('Same.Name', 'editor'))
      const second = await toa(createArgs('same-name', 'editor'))
      expect(first.code).toBe(0)
      expect(second.code).toBe(0)
      expect((await accountOf('Same.Name'))?.nicename).toBe('same-name')
      expect((await accountOf('same-name'))?.nicename).toBe('same-name-2')
    })

    it('refuses a username that exists, whatever its case, and creates nothing', async () => {
      const username = unique('taken')
      expect((await toa(createArgs(username, 'editor'))).code).toBe(0)
      const before = Number((await query<{ n: string }>(db.url, 'select count(*) as n from account'))[0]?.n)
      const audits = Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)

      for (const variant of [username, username.toUpperCase()]) {
        const result = await toa(createArgs(variant, 'subscriber', `other-${variant}@example.test`))
        expect(result.code).toBe(1)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('--username:')
        expect(result.stderr).not.toContain('--email:')
        expect(result.stderr).not.toContain(variant)
      }
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from account'))[0]?.n)).toBe(before)
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)).toBe(audits)
    })

    it('refuses an e-mail address that exists, whatever its case', async () => {
      const username = unique('mailtaken')
      expect((await toa(createArgs(username, 'editor', `${username}@Example.Test`))).code).toBe(0)
      const result = await toa(createArgs(unique('mailother'), 'editor', `${username.toUpperCase()}@example.test`))
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('--email:')
      expect(result.stderr).not.toContain('--username:')
      expect(result.stderr).not.toContain('@example.test')
    })

    it('names both fields when both are taken', async () => {
      const username = unique('both')
      await toa(createArgs(username, 'editor'))
      const result = await toa(createArgs(username, 'editor'))
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('--username:')
      expect(result.stderr).toContain('--email:')
    })

    it('refuses an unknown role, lists the roles, and creates nothing', async () => {
      const username = unique('norole')
      const result = await toa(createArgs(username, 'superuser'))
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('--role:')
      for (const slug of BUILT_IN_ROLES) {
        expect(result.stderr).toContain(slug)
      }
      expect(result.stderr).not.toContain('superuser')
      expect(await accountOf(username)).toBeUndefined()
    })

    it('lets only one of two creations of the same username at once win', async () => {
      const username = unique('race')
      const results = await Promise.all([
        toa(createArgs(username, 'editor', `${username}-a@example.test`)),
        toa(createArgs(username, 'editor', `${username}-b@example.test`)),
      ])
      expect(results.map((result) => result.code).sort()).toEqual([0, 1])
      const loser = results.find((result) => result.code === 1)
      expect(loser?.stderr).toContain('--username:')
      expect(loser?.stdout).toBe('')
      const rows = await query(db.url, 'select 1 from account where lower(username) = $1', [username])
      expect(rows).toHaveLength(1)
    })

    it('rolls back the account when the audit entry cannot be written', async () => {
      const username = unique('atomic')
      await query(db.url, 'alter table audit_log rename to audit_log_away')
      try {
        const result = await toa(createArgs(username, 'editor'))
        expect(result.code).toBe(1)
        expect(result.stdout).toBe('')
      } finally {
        await query(db.url, 'alter table audit_log_away rename to audit_log')
      }
      expect(await accountOf(username)).toBeUndefined()
    })
  })

  describe('user reset-password', () => {
    const NEW_PASSWORD = 'a brand new passphrase 77'

    async function accountWithTraces(base: string) {
      const username = unique(base)
      await toa([...createArgs(username, 'editor'), '--password-stdin'], `${GOOD_PASSWORD}\n`)
      const account = await accountOf(username)
      const id = account?.id ?? ''
      for (const hash of ['s1', 's2']) {
        await query(
          db.url,
          "insert into session (account_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
          [id, `${username}-${hash}`],
        )
      }
      await query(
        db.url,
        "insert into account_token (account_id, purpose, token_hash, expires_at) values ($1, 'password_reset', $2, now() + interval '1 day')",
        [id, `${username}-link`],
      )
      return { username, id, email: `${username}@example.test`, oldHash: account?.password_hash ?? '' }
    }

    const sessionCount = async (id: string) =>
      Number(
        (await query<{ n: string }>(db.url, 'select count(*) as n from session where account_id = $1', [id]))[0]?.n,
      )

    it('sets the password from standard input, ends every session, voids the links and writes the audit entry', async () => {
      const victim = await accountWithTraces('reset')
      const bystander = await accountWithTraces('bystander')

      const result = await toa(
        ['user', 'reset-password', '--username', victim.username, '--password-stdin'],
        `${NEW_PASSWORD}\n`,
      )
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('ended 2 session(s)')

      const after = await accountOf(victim.username)
      expect(after?.password_hash).not.toBe(victim.oldHash)
      expect((await verifyPassword(NEW_PASSWORD, after?.password_hash ?? '')).valid).toBe(true)
      expect((await verifyPassword(GOOD_PASSWORD, after?.password_hash ?? '')).valid).toBe(false)
      expect(after?.status).toBe('active')

      expect(await sessionCount(victim.id)).toBe(0)
      expect(await sessionCount(bystander.id)).toBe(2)
      const links = await query<{ used_at: Date | null }>(
        db.url,
        'select used_at from account_token where account_id = $1',
        [victim.id],
      )
      expect(links.every((link) => link.used_at !== null)).toBe(true)
      const untouched = await query<{ used_at: Date | null }>(
        db.url,
        'select used_at from account_token where account_id = $1',
        [bystander.id],
      )
      expect(untouched.every((link) => link.used_at === null)).toBe(true)

      const entries = await auditOf(victim.id)
      const reset = entries.find((entry) => entry.action === 'password.reset')
      expect(reset).toMatchObject({
        actor_type: 'system',
        actor: 'cli',
        source: 'cli',
        account_id: victim.id,
        new_value: { sessionsEnded: 2, linksVoided: 1 },
      })
      expect(JSON.stringify(result.lines)).not.toContain(NEW_PASSWORD)
    })

    it('finds the account by e-mail address, whatever its case, and prints a generated password once', async () => {
      const victim = await accountWithTraces('byemail')
      const result = await toa(['user', 'reset-password', '--email', victim.email.toUpperCase()])
      expect(result.code).toBe(0)
      const password = result.stdout.trim()
      expect(password).toHaveLength(24)
      expect(result.stdout.split(password)).toHaveLength(2)
      expect(JSON.stringify(result.lines)).not.toContain(password)
      expect(result.stderr).not.toContain(password)
      const after = await accountOf(victim.username)
      expect((await verifyPassword(password, after?.password_hash ?? '')).valid).toBe(true)
      expect(await sessionCount(victim.id)).toBe(0)
    })

    it('says which flag found no account, and writes nothing', async () => {
      const audits = Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)
      const byName = await toa(['user', 'reset-password', '--username', 'nobodyhere'])
      expect(byName.code).toBe(1)
      expect(byName.stderr).toContain('--username: no account has that username')
      expect(byName.stdout).toBe('')
      const byMail = await toa(['user', 'reset-password', '--email', 'nobody@example.test'])
      expect(byMail.code).toBe(1)
      expect(byMail.stderr).toContain('--email: no account has that e-mail address')
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)).toBe(audits)
    })

    it('refuses a password equal to the account address and changes nothing', async () => {
      const victim = await accountWithTraces('obvious')
      const result = await toa(
        ['user', 'reset-password', '--username', victim.username, '--password-stdin'],
        `${victim.email}\n`,
      )
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('must not be the username or the e-mail address')
      expect((await accountOf(victim.username))?.password_hash).toBe(victim.oldHash)
      expect(await sessionCount(victim.id)).toBe(2)
    })

    it('leaves the status alone and says so for a pending or disabled account', async () => {
      for (const status of ['pending', 'disabled']) {
        const victim = await accountWithTraces(status)
        await query(db.url, 'update account set status = $2 where id = $1', [victim.id, status])
        const result = await toa(['user', 'reset-password', '--username', victim.username])
        expect(result.code).toBe(0)
        expect(result.stderr).toContain(`The account is ${status}`)
        expect((await accountOf(victim.username))?.status).toBe(status)
      }
    })

    it('rolls everything back when the audit entry cannot be written', async () => {
      const victim = await accountWithTraces('rollback')
      await query(db.url, 'alter table audit_log rename to audit_log_away')
      try {
        const result = await toa(
          ['user', 'reset-password', '--username', victim.username, '--password-stdin'],
          `${NEW_PASSWORD}\n`,
        )
        expect(result.code).toBe(1)
      } finally {
        await query(db.url, 'alter table audit_log_away rename to audit_log')
      }
      expect((await accountOf(victim.username))?.password_hash).toBe(victim.oldHash)
      expect(await sessionCount(victim.id)).toBe(2)
    })
  })

  describe('user reset-login-limit', () => {
    async function accountWithFailures(base: string) {
      const username = unique(base)
      await toa(createArgs(username, 'editor'))
      const id = (await accountOf(username))?.id ?? ''
      // The api's own rows: five failures of each action, as the limiter writes them.
      for (const action of ['login', 'mfa', 'password_lost', 'register']) {
        for (let n = 0; n < 5; n += 1) {
          await query(db.url, `insert into login_attempt (action, ip, account_id) values ($1, '192.0.2.1', $2)`, [
            action,
            id,
          ])
        }
      }
      return { username, id, email: `${username}@example.test` }
    }

    const markers = (id: string) =>
      query<{ action: string; succeeded: boolean; ip: string }>(
        db.url,
        `select action, succeeded, host(ip) as ip from login_attempt where account_id = $1 and succeeded order by action`,
        [id],
      )

    it('ends the streak with one succeeded row per action, writes the audit entry, and changes nothing else', async () => {
      const victim = await accountWithFailures('limit')
      const bystander = await accountWithFailures('limit-other')
      const before = await accountOf(victim.username)

      const result = await toa(['user', 'reset-login-limit', '--username', victim.username])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Ended the wait after failed attempts')

      expect(await markers(victim.id)).toEqual([
        { action: 'login', succeeded: true, ip: '0.0.0.0' },
        { action: 'mfa', succeeded: true, ip: '0.0.0.0' },
        { action: 'password_lost', succeeded: true, ip: '0.0.0.0' },
        { action: 'register', succeeded: true, ip: '0.0.0.0' },
      ])
      expect(await markers(bystander.id)).toEqual([])
      // The failures are still there (the table is append-only), and so are the account and its password.
      expect(
        Number(
          (
            await query<{ n: string }>(
              db.url,
              'select count(*) as n from login_attempt where account_id = $1 and not succeeded',
              [victim.id],
            )
          )[0]?.n,
        ),
      ).toBe(20)
      expect(await accountOf(victim.username)).toEqual(before)
      const entries = await auditOf(victim.id)
      expect(entries.find((entry) => entry.action === 'login_limit.reset')).toMatchObject({
        actor_type: 'system',
        actor: 'cli',
        source: 'cli',
        account_id: victim.id,
      })
    })

    it('finds the account by e-mail address in any case, and says which flag found no account', async () => {
      const victim = await accountWithFailures('limit-mail')
      expect((await toa(['user', 'reset-login-limit', '--email', victim.email.toUpperCase()])).code).toBe(0)
      expect(await markers(victim.id)).toHaveLength(4)

      const rows = Number((await query<{ n: string }>(db.url, 'select count(*) as n from login_attempt'))[0]?.n)
      const byName = await toa(['user', 'reset-login-limit', '--username', 'nobodyhere'])
      expect(byName.code).toBe(1)
      expect(byName.stderr).toContain('--username: no account has that username')
      const byMail = await toa(['user', 'reset-login-limit', '--email', 'nobody@example.test'])
      expect(byMail.code).toBe(1)
      expect(byMail.stderr).toContain('--email: no account has that e-mail address')
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from login_attempt'))[0]?.n)).toBe(rows)
    })

    it('rolls the markers back when the audit entry cannot be written', async () => {
      const victim = await accountWithFailures('limit-rollback')
      await query(db.url, 'alter table audit_log rename to audit_log_away')
      try {
        expect((await toa(['user', 'reset-login-limit', '--username', victim.username])).code).toBe(1)
      } finally {
        await query(db.url, 'alter table audit_log_away rename to audit_log')
      }
      expect(await markers(victim.id)).toEqual([])
    })

    it('reset-password ends the streak too, for the actions about the password', async () => {
      const victim = await accountWithFailures('limit-pw')
      const result = await toa(['user', 'reset-password', '--username', victim.username])
      expect(result.code).toBe(0)
      expect((await markers(victim.id)).map((row) => row.action)).toEqual(['login', 'password_lost'])
    })
  })

  describe('user mfa-reset', () => {
    interface Queued {
      name: string
      data: { template: string; to: string; data: Record<string, unknown> }
    }
    const queuedFor = (to: string) =>
      query<Queued>(
        db.url,
        `select name, data from pgboss.job where name = 'email.send' and data->>'to' = $1 order by created_on`,
        [to],
      )
    const count = async (table: string, id: string) =>
      Number(
        (await query<{ n: string }>(db.url, `select count(*) as n from ${table} where account_id = $1`, [id]))[0]?.n,
      )

    /** An account with a confirmed app, an unfinished enrolment, a used and an unused recovery code, and two sessions. */
    async function accountWithMfa(base: string, role = 'editor') {
      const username = unique(base)
      const email = `${username}@example.test`
      await toa(createArgs(username, role, email))
      const id = (await accountOf(username))?.id ?? ''
      await query(
        db.url,
        `insert into mfa_credential (account_id, type, name, secret_encrypted, confirmed_at)
         values ($1, 'totp', 'phone', 'v1:secret-ciphertext', now()), ($1, 'totp', null, 'v1:other-ciphertext', null)`,
        [id],
      )
      await query(
        db.url,
        `insert into recovery_code (account_id, code_hash, used_at) values ($1, 'hash-a', null), ($1, 'hash-b', now())`,
        [id],
      )
      for (const suffix of ['a', 'b']) {
        await query(
          db.url,
          "insert into session (account_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
          [id, `${username}-${suffix}`],
        )
      }
      return { username, email, id }
    }

    it('removes every factor and recovery code, ends the sessions, audits and queues the notice', async () => {
      const victim = await accountWithMfa('mfareset')
      const bystander = await accountWithMfa('mfareset-other')
      const before = await accountOf(victim.username)

      const result = await toa(['user', 'mfa-reset', '--username', victim.username])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Removed 2 second factor(s) and 2 recovery code(s)')
      expect(result.stderr).toContain('ended 2 session(s)')
      expect(result.stderr).toContain('A security notice is queued')
      expect(result.stderr).toContain('needs only the password')

      expect(await count('mfa_credential', victim.id)).toBe(0)
      expect(await count('recovery_code', victim.id)).toBe(0)
      expect(await count('session', victim.id)).toBe(0)
      // Nobody else's rows, and the account itself, its password included, are as they were.
      expect(await count('mfa_credential', bystander.id)).toBe(2)
      expect(await count('recovery_code', bystander.id)).toBe(2)
      expect(await count('session', bystander.id)).toBe(2)
      expect(await accountOf(victim.username)).toEqual(before)

      const entry = (await auditOf(victim.id)).find((row) => row.action === 'mfa.reset')
      expect(entry).toMatchObject({
        actor_type: 'system',
        actor: 'cli',
        source: 'cli',
        account_id: victim.id,
        ip: null,
        new_value: { factorsRemoved: { totp: 2 }, recoveryCodesRemoved: 2, sessionsEnded: 2 },
      })

      const jobs = await queuedFor(victim.email)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.data).toEqual({
        template: 'security_notice',
        to: victim.email,
        data: { username: victim.username, action: 'mfa_reset' },
      })
      expect(await queuedFor(bystander.email)).toEqual([])

      // Nothing secret anywhere in what the command said.
      const everything = JSON.stringify([result, jobs])
      for (const secret of ['secret-ciphertext', 'other-ciphertext', 'hash-a', 'hash-b']) {
        expect(everything).not.toContain(secret)
      }
      // pg-boss's own log lines are the only ones, and they hold no address.
      expect(JSON.stringify(result.lines)).not.toContain(victim.email)
    })

    it('finds the account by e-mail address in any case, and --notify changes nothing', async () => {
      const victim = await accountWithMfa('mfareset-mail')
      const result = await toa(['user', 'mfa-reset', '--email', victim.email.toUpperCase(), '--notify'])
      expect(result.code).toBe(0)
      expect(await count('mfa_credential', victim.id)).toBe(0)
      expect(await queuedFor(victim.email)).toHaveLength(1)
    })

    it('says that the next login is an enrolment when a role of the account requires 2FA', async () => {
      const victim = await accountWithMfa('mfareset-required', 'editor')
      await query(
        db.url,
        `insert into setting (key, value) values ('mfa_required_roles', '["editor"]'::jsonb)
         on conflict (key) do update set value = excluded.value`,
      )
      try {
        const result = await toa(['user', 'mfa-reset', '--username', victim.username])
        expect(result.code).toBe(0)
        expect(result.stderr).toContain('The role editor requires a second factor (mfa_required_roles)')
        expect(result.stderr).toContain('next login lands in enrolment')
      } finally {
        await query(db.url, `delete from setting where key = 'mfa_required_roles'`)
      }
    })

    it('an account without factors still ends its sessions and gets the notice; a repeat is dropped as a duplicate', async () => {
      const username = unique('mfareset-none')
      await toa(createArgs(username, 'author'))
      const id = (await accountOf(username))?.id ?? ''
      await query(
        db.url,
        "insert into session (account_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
        [id, `${username}-s`],
      )
      const result = await toa(['user', 'mfa-reset', '--username', username])
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('Removed 0 second factor(s) and 0 recovery code(s)')
      expect(await count('session', id)).toBe(0)
      expect(await queuedFor(`${username}@example.test`)).toHaveLength(1)
      // The queue drops the same notice within a minute, so a repeated command does not flood the inbox.
      expect((await toa(['user', 'mfa-reset', '--username', username])).code).toBe(0)
      expect(await queuedFor(`${username}@example.test`)).toHaveLength(1)
    })

    it('an unknown account exits 1, says which flag found nothing, and changes and queues nothing', async () => {
      const bystander = await accountWithMfa('mfareset-bystander')
      const jobs = Number((await query<{ n: string }>(db.url, 'select count(*) as n from pgboss.job'))[0]?.n)
      const audits = Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)
      const byName = await toa(['user', 'mfa-reset', '--username', 'nobodyhere'])
      expect(byName.code).toBe(1)
      expect(byName.stdout).toBe('')
      expect(byName.stderr).toContain('--username: no account has that username')
      const byMail = await toa(['user', 'mfa-reset', '--email', 'nobody@example.test'])
      expect(byMail.code).toBe(1)
      expect(byMail.stderr).toContain('--email: no account has that e-mail address')
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from pgboss.job'))[0]?.n)).toBe(jobs)
      expect(Number((await query<{ n: string }>(db.url, 'select count(*) as n from audit_log'))[0]?.n)).toBe(audits)
      expect(await count('mfa_credential', bystander.id)).toBe(2)
    })

    it('rolls everything back when the audit entry cannot be written, and queues no notice', async () => {
      const victim = await accountWithMfa('mfareset-rollback')
      await query(db.url, 'alter table audit_log rename to audit_log_away')
      try {
        const result = await toa(['user', 'mfa-reset', '--username', victim.username])
        expect(result.code).toBe(1)
        expect(result.stderr).toContain('user mfa-reset failed')
      } finally {
        await query(db.url, 'alter table audit_log_away rename to audit_log')
      }
      expect(await count('mfa_credential', victim.id)).toBe(2)
      expect(await count('recovery_code', victim.id)).toBe(2)
      expect(await count('session', victim.id)).toBe(2)
      expect(await queuedFor(victim.email)).toEqual([])
    })

    it('exits 1 and says the reset stands when the notice cannot be queued, without printing the address', async () => {
      const victim = await accountWithMfa('mfareset-queue')
      const log = memoryLogger()
      const result = await run(['user', 'mfa-reset', '--username', victim.username], VERSION, {
        env: { DATABASE_URL: db.url, NODE_ENV: 'production' },
        logger: log.logger,
        mail: {
          sendMail: () => Promise.reject(new Error(`queue down for ${victim.email}`)),
          stop: () => Promise.resolve(),
        },
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('are removed')
      expect(result.stderr).toContain('could not be queued')
      expect(result.stderr).toContain('Run the command again')
      expect(result.stderr).not.toContain(victim.email)
      expect(await count('mfa_credential', victim.id)).toBe(0)
      expect(await count('session', victim.id)).toBe(0)
      expect((await auditOf(victim.id)).some((row) => row.action === 'mfa.reset')).toBe(true)
    })

    it('hands the notice to the injected queue exactly as the api would send it', async () => {
      const victim = await accountWithMfa('mfareset-inject')
      const sent: unknown[] = []
      const result = await run(['user', 'mfa-reset', '--email', victim.email], VERSION, {
        env: { DATABASE_URL: db.url, NODE_ENV: 'production' },
        logger: memoryLogger().logger,
        mail: {
          sendMail: (message) => {
            sent.push(message)
            return Promise.resolve({ jobId: 'job-1' })
          },
          stop: () => Promise.resolve(),
        },
      })
      expect(result.code).toBe(0)
      expect(sent).toEqual([
        {
          template: 'security_notice',
          to: victim.email,
          data: { username: victim.username, action: 'mfa_reset' },
        },
      ])
    })
  })

  describe('the real entry point', () => {
    function execNode(
      args: readonly string[],
      stdin?: string,
    ): Promise<{ code: number | null; stdout: string; stderr: string }> {
      return new Promise((resolve) => {
        const child = execFile(
          process.execPath,
          ['--conditions=source', ENTRY, ...args],
          {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production', DATABASE_URL: db.url },
            timeout: 30_000,
          },
          (error, stdout, stderr) => {
            resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
          },
        )
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(stdin ?? '')
      })
    }

    it('creates an account from standard input and resets it again; stdout carries only the password, the log goes to stderr', async () => {
      const username = unique('entry')
      const made = await execNode([...createArgs(username, 'administrator'), '--password-stdin'], `${GOOD_PASSWORD}\n`)
      expect(made.code).toBe(0)
      expect(made.stdout).toBe('')
      expect(made.stderr).toContain('account created')
      expect(made.stderr).not.toContain(GOOD_PASSWORD)
      expect((await accountOf(username))?.status).toBe('active')

      const reset = await execNode(['user', 'reset-password', '--username', username])
      expect(reset.code).toBe(0)
      expect(reset.stdout).toMatch(/^\S{24}\n$/)
      expect(reset.stderr).toContain('password reset')
      expect(reset.stderr).not.toContain(reset.stdout.trim())
      const after = await accountOf(username)
      expect((await verifyPassword(reset.stdout.trim(), after?.password_hash ?? '')).valid).toBe(true)
    })

    it('mfa-reset through the real entry point queues the notice and the process ends by itself', async () => {
      const username = unique('entry-mfa')
      await execNode(createArgs(username, 'editor'))
      const id = (await accountOf(username))?.id ?? ''
      await query(
        db.url,
        "insert into mfa_credential (account_id, type, secret_encrypted, confirmed_at) values ($1, 'totp', 'v1:entry-secret', now())",
        [id],
      )
      const result = await execNode(['user', 'mfa-reset', '--username', username])
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toContain('entry-secret')
      expect(result.stderr).toContain('e-mail queued')
      const jobs = await query(db.url, `select 1 from pgboss.job where name = 'email.send' and data->>'to' = $1`, [
        `${username}@example.test`,
      ])
      expect(jobs).toHaveLength(1)
    })

    it('exits 2 with the usage for bad arguments and 1 for a refusal', async () => {
      expect((await execNode(['user', 'create'])).code).toBe(2)
      expect((await execNode(createArgs(unique('norole'), 'nope'))).code).toBe(1)
    })

    it('refuses a password on standard input that is far too long', async () => {
      const result = await execNode([...createArgs(unique('long'), 'editor'), '--password-stdin'], 'x'.repeat(70_000))
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('too long')
    })
  })
})
