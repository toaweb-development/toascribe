// `toa core gen-env|install|is-installed|setup-token`: the arguments and refusals (no database is reached), `gen-env` with an
// empty environment, and the commands against a real, migrated PostgreSQL (TEST_DATABASE_URL).
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { hashToken, verifyPassword } from '@toascribe/auth'
import { runMigrations } from '@toascribe/db'
import { verifyRecoveryKey } from '@toascribe/install'
import { RECOVERY_KEY_PATTERN, keyMaterialEnv, parseKeyMaterial } from '@toascribe/shared'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GEN_ENV_NAMES } from '../src/commands/core.ts'
import type { Prompter } from '../src/prompt.ts'
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

noticeIfSkipped('core')

const VERSION = '1.2.3'
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const ORIGIN = 'https://cms.example.test'
const GOOD_PASSWORD = 'correct horse battery staple'
const SMTP_ENV = { SMTP_HOST: 'smtp.example.test', MAIL_FROM_ADDRESS: 'noreply@example.test' } as const

const INSTALL: readonly string[] = [
  'core',
  'install',
  '--url',
  ORIGIN,
  '--title',
  'Min blogg',
  '--admin-user',
  'tor',
  '--admin-email',
  'tor@example.test',
]

function parseEnvLines(stdout: string): Record<string, string> {
  const lines = stdout.split('\n')
  expect(lines.at(-1)).toBe('')
  return Object.fromEntries(
    lines.slice(0, -1).map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at), line.slice(at + 1)]
    }),
  )
}

describe('toa core gen-env (no database, no environment)', () => {
  it('prints the five lines docker/.env needs, in order, as 32 random bytes in hex, all different', async () => {
    const result = await run(['core', 'gen-env'], VERSION, { env: {} })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const values = parseEnvLines(result.stdout)
    expect(Object.keys(values)).toEqual([...GEN_ENV_NAMES])
    expect(Object.keys(values)).toEqual([
      'POSTGRES_PASSWORD',
      'POSTGRES_OWNER_PASSWORD',
      'POSTGRES_APP_PASSWORD',
      'TOASCRIBE_ENCRYPTION_KEY',
      'TOASCRIBE_SIGNING_KEY',
    ])
    for (const value of Object.values(values)) {
      expect(value).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(new Set(Object.values(values)).size).toBe(5)
    // The keys are ones the api and the worker accept (32 random bytes), and the two differ, which the api demands.
    const encryption = keyMaterialEnv.parse(values['TOASCRIBE_ENCRYPTION_KEY'])
    const signing = keyMaterialEnv.parse(values['TOASCRIBE_SIGNING_KEY'])
    expect(parseKeyMaterial(values['TOASCRIBE_ENCRYPTION_KEY'] ?? '')).toEqual(encryption)
    expect(Buffer.from(encryption).equals(Buffer.from(signing))).toBe(false)
    // The passwords go into database URLs: hex needs no escaping.
    for (const name of ['POSTGRES_PASSWORD', 'POSTGRES_OWNER_PASSWORD', 'POSTGRES_APP_PASSWORD']) {
      expect(encodeURIComponent(values[name] ?? '')).toBe(values[name])
    }
  })

  it('makes new values every time', async () => {
    const seen = new Set<string>()
    for (let n = 0; n < 5; n += 1) {
      const result = await run(['core', 'gen-env'], VERSION, { env: {} })
      for (const value of Object.values(parseEnvLines(result.stdout))) {
        seen.add(value)
      }
    }
    expect(seen.size).toBe(25)
  })

  it('warns, by name only, when a variable is already set, and still prints fresh values', async () => {
    const result = await run(['core', 'gen-env'], VERSION, {
      env: { POSTGRES_PASSWORD: 'already-in-use-secret', TOASCRIBE_SIGNING_KEY: 'x', POSTGRES_APP_PASSWORD: '' },
    })
    expect(result.code).toBe(0)
    expect(Object.keys(parseEnvLines(result.stdout))).toHaveLength(5)
    expect(result.stderr).toContain('POSTGRES_PASSWORD, TOASCRIBE_SIGNING_KEY are already set')
    expect(result.stderr).not.toContain('POSTGRES_APP_PASSWORD')
    expect(result.stderr).not.toContain('already-in-use-secret')
    expect(result.stdout).not.toContain('already-in-use-secret')
  })

  it('takes no arguments', async () => {
    const result = await run(['core', 'gen-env', '--force'], VERSION, { env: {} })
    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('takes no arguments')
  })

  it('works through the real entry point with nothing in the environment, and ends by itself', async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        ['--conditions=source', ENTRY, 'core', 'gen-env'],
        { encoding: 'utf8', env: {}, timeout: 30_000 },
        (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
        },
      )
      child.stdin?.end()
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(Object.keys(parseEnvLines(result.stdout))).toHaveLength(5)
  })

  it('is named in the usage text, with the way to append it', () => {
    expect(USAGE).toContain('core gen-env')
    expect(USAGE).toContain('toa core gen-env >> docker/.env')
  })
})

describe('toa core: arguments and refusals (no database is reached)', () => {
  let probe: ConnectionProbe

  beforeAll(async () => {
    probe = await startConnectionProbe()
  })
  afterAll(async () => {
    await probe.close()
  })

  const noTerminal: Prompter = {
    interactive: false,
    ask: () => Promise.reject(new Error('asked a question without a terminal')),
    say: () => undefined,
  }

  async function refused(argv: readonly string[], stdin = '', env: Record<string, string> = {}) {
    const before = probe.connections()
    const log = memoryLogger()
    const result = await run(argv, VERSION, {
      env: { DATABASE_URL: probe.url, PUBLIC_ORIGIN: ORIGIN, ...env },
      logger: log.logger,
      prompt: noTerminal,
      readStdin: () => Promise.resolve(stdin),
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(probe.connections()).toBe(before)
    expect(log.lines).toEqual([])
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('probe-secret-pw')
    return result
  }

  it('install without the flags it needs, outside a terminal, exits 2 with the usage and asks nothing', async () => {
    const result = await refused(['core', 'install'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--url, --title, --admin-user, --admin-email')
    expect(result.stderr).toContain('core install')
    const some = await refused(['core', 'install', '--url', ORIGIN, '--title', 'x'])
    expect(some.stderr).toContain('--admin-user, --admin-email')
    expect(some.stderr.split('\n\nUsage:')[0]).not.toContain('--url')
  })

  it('install with --admin-password-stdin never asks: the flags are required', async () => {
    const result = await refused(['core', 'install', '--admin-password-stdin', '--title', 'x'], `${GOOD_PASSWORD}\n`)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('nothing is asked')
    expect(result.stderr).not.toContain(GOOD_PASSWORD)
  })

  it.each([
    [['--url', 'https://cms.example.test/blog'], '--url'],
    [['--url', 'ftp://cms.example.test'], '--url'],
    [['--url', 'https://user:pw@cms.example.test'], '--url'],
    [['--url', 'not a url'], '--url'],
    [['--title', ''], '--title'],
    [['--title', 'a\nb'], '--title'],
    [['--timezone', 'Mars/Olympus'], '--timezone'],
    [['--admin-user', 'a b'], '--admin-user'],
    [['--admin-email', 'nope'], '--admin-email'],
  ])('install refuses %j without echoing it', async (override, flag) => {
    const base = [...INSTALL]
    const at = base.indexOf(override[0] ?? '')
    const argv =
      at === -1 ? [...base, ...override] : base.map((part, index) => (index === at + 1 ? (override[1] ?? '') : part))
    const result = await refused(argv)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(`${flag}:`)
    expect(result.stderr).not.toContain(override[1] === '' ? '\u0000' : (override[1] ?? ''))
  })

  it('install refuses a password on the command line and a stray argument, by name only', async () => {
    const a = await refused([...INSTALL, '--admin-password', 'hunter2'])
    expect(a.code).toBe(2)
    expect(a.stderr).toContain('--admin-password-stdin')
    expect(a.stderr).not.toContain('hunter2')
    const b = await refused([...INSTALL, 'hunter2'])
    expect(b.code).toBe(2)
    expect(b.stderr).not.toContain('hunter2')
  })

  it('install refuses a password on standard input that is not one', async () => {
    const result = await refused([...INSTALL, '--admin-password-stdin'], 'short\n')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--admin-password-stdin')
    expect(result.stderr).not.toContain('short')
  })

  it('is-installed and setup-token take no arguments', async () => {
    expect((await refused(['core', 'is-installed', '--verbose'])).code).toBe(2)
    expect((await refused(['core', 'setup-token', 'now'])).code).toBe(2)
  })

  it('is-installed exits 2, and prints nothing on stdout, when the environment or the database is wrong', async () => {
    const missing = await run(['core', 'is-installed'], VERSION, { env: {} })
    expect(missing.code).toBe(2)
    expect(missing.stdout).toBe('')
    expect(missing.stderr).toContain('DATABASE_URL')

    // A server that drops every connection: not «not installed».
    const before = probe.connections()
    const log = memoryLogger()
    const dropped = await run(['core', 'is-installed'], VERSION, {
      env: { DATABASE_URL: probe.url },
      logger: log.logger,
    })
    expect(dropped.code).toBe(2)
    expect(dropped.stdout).toBe('')
    expect(probe.connections()).toBeGreaterThan(before)
    expect(JSON.stringify(log.lines)).not.toContain('probe-secret-pw')
  })

  it('setup-token and install name the variable that is missing, never its value', async () => {
    for (const argv of [['core', 'setup-token'], [...INSTALL]]) {
      const result = await run(argv, VERSION, {
        env: { DATABASE_URL: probe.url, PUBLIC_ORIGIN: 'not-a-url' },
        prompt: noTerminal,
      })
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('PUBLIC_ORIGIN')
      expect(result.stderr).not.toContain('not-a-url')
      expect(result.stderr).not.toContain('probe-secret-pw')
    }
  })

  it('names the commands in the usage text', () => {
    for (const text of [
      'core install',
      'core is-installed',
      'core setup-token',
      '--admin-password-stdin',
      '--skip-email',
      '--no-index',
    ]) {
      expect(USAGE).toContain(text)
    }
  })
})

interface Counts {
  accounts: number
  content: number
  comments: number
  audits: number
  settings: number
  secrets: number
  notices: number
}

describe.skipIf(TEST_DATABASE_URL === undefined)('toa core against PostgreSQL', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase()
    await runMigrations({ connectionString: db.url, logger: pino({ level: 'silent' }) })
  })
  afterAll(async () => {
    await db.drop()
  })

  /** Back to what the migrations and the seed leave: no accounts, no content, no settings, nothing installed. */
  beforeEach(async () => {
    await query(
      db.url,
      `truncate comment, content_author, content_term, content, term, audit_log, login_attempt, session, account_token,
       account_role, account, site_secret, admin_notice restart identity cascade`,
    )
    await query(db.url, 'delete from setting')
    await runMigrations({ connectionString: db.url, logger: pino({ level: 'silent' }) })
  })

  const baseEnv = { PUBLIC_ORIGIN: ORIGIN, NODE_ENV: 'production' }

  async function toa(
    argv: readonly string[],
    options: { stdin?: string; env?: Record<string, string>; prompt?: Prompter } = {},
  ) {
    const log = memoryLogger()
    const result = await run(argv, VERSION, {
      env: { ...baseEnv, DATABASE_URL: db.url, ...options.env },
      logger: log.logger,
      prompt: options.prompt ?? {
        interactive: false,
        ask: () => Promise.reject(new Error('asked a question without a terminal')),
        say: () => undefined,
      },
      readStdin: () => Promise.resolve(options.stdin ?? ''),
    })
    return { ...result, ...log }
  }

  async function count(table: string, where = 'true'): Promise<number> {
    return Number((await query<{ n: string }>(db.url, `select count(*) as n from ${table} where ${where}`))[0]?.n)
  }

  async function counts(): Promise<Counts> {
    return {
      accounts: await count('account'),
      content: await count('content'),
      comments: await count('comment'),
      audits: await count('audit_log'),
      settings: await count('setting'),
      secrets: await count('site_secret'),
      notices: await count('admin_notice'),
    }
  }

  const settingOf = async (key: string): Promise<unknown> =>
    (await query<{ value: unknown }>(db.url, 'select value from setting where key = $1', [key]))[0]?.value

  /** The recovery key on a stdout line. */
  function recoveryKeyOf(stdout: string): string {
    const found = /^Recovery key \(shown once, keep it safe\): (\S+)$/m.exec(stdout)?.[1]
    expect(found).toBeDefined()
    return found ?? ''
  }

  function generatedPasswordOf(stdout: string): string {
    return /^Administrator password \(generated, shown once\): (\S+)$/m.exec(stdout)?.[1] ?? ''
  }

  describe('core is-installed', () => {
    it('exits 1 before the install and 0 after it, and prints nothing either time', async () => {
      const before = await toa(['core', 'is-installed'])
      expect(before).toMatchObject({ code: 1, stdout: '', stderr: '' })
      expect(
        (await toa([...INSTALL, '--admin-password-stdin', '--skip-email'], { stdin: `${GOOD_PASSWORD}\n` })).code,
      ).toBe(0)
      const after = await toa(['core', 'is-installed'])
      expect(after).toMatchObject({ code: 0, stdout: '', stderr: '' })
      expect(after.lines).toEqual([])
    })

    it('exits 2, not 1, for a database without the tables', async () => {
      const bare = await createTestDatabase()
      try {
        const result = await run(['core', 'is-installed'], VERSION, {
          env: { DATABASE_URL: bare.url },
          logger: memoryLogger().logger,
        })
        expect(result.code).toBe(2)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('core is-installed failed')
      } finally {
        await bare.drop()
      }
    })
  })

  describe('core setup-token', () => {
    it('makes a token, prints it with the address of the wizard and keeps only its hash', async () => {
      const result = await toa(['core', 'setup-token'])
      expect(result.code).toBe(0)
      const token = /^Setup token: (\S+)$/m.exec(result.stdout)?.[1] ?? ''
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(result.stdout).toContain(`Setup address: ${ORIGIN}/admin/setup#token=${token}\n`)
      expect(result.stderr).not.toContain(token)
      expect(JSON.stringify(result.lines)).not.toContain(token)
      const rows = await query<{ secret_hash: string }>(
        db.url,
        `select secret_hash from site_secret where purpose = 'setup_token'`,
      )
      expect(rows).toEqual([{ secret_hash: hashToken(token) }])
    })

    it('replaces the token: the earlier one stops working', async () => {
      const first = /^Setup token: (\S+)$/m.exec((await toa(['core', 'setup-token'])).stdout)?.[1] ?? ''
      const second = /^Setup token: (\S+)$/m.exec((await toa(['core', 'setup-token'])).stdout)?.[1] ?? ''
      expect(second).not.toBe(first)
      const rows = await query<{ secret_hash: string }>(
        db.url,
        `select secret_hash from site_secret where purpose = 'setup_token'`,
      )
      expect(rows).toEqual([{ secret_hash: hashToken(second) }])
    })

    it('exits 1 for an installed site, prints no token and leaves nothing behind', async () => {
      await toa([...INSTALL, '--skip-email'])
      const before = await counts()
      const result = await toa(['core', 'setup-token'])
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('already installed')
      expect(await counts()).toEqual(before)
      expect(await count('site_secret', `purpose = 'setup_token'`)).toBe(0)
    })
  })

  describe('core install, non-interactive', () => {
    it('installs a complete site and prints the recovery key and the generated password once, labelled', async () => {
      const result = await toa([...INSTALL, '--skip-email'])
      expect(result.code).toBe(0)

      const lines = result.stdout.split('\n')
      expect(lines).toHaveLength(3)
      const password = generatedPasswordOf(result.stdout)
      const key = recoveryKeyOf(result.stdout)
      expect(password.length).toBeGreaterThanOrEqual(12)
      expect(key).toMatch(RECOVERY_KEY_PATTERN)

      // Nothing secret on stderr or in the log.
      const everything = JSON.stringify([result.stderr, result.lines])
      expect(everything).not.toContain(password)
      expect(everything).not.toContain(key)
      expect(result.stderr).toContain(`${ORIGIN}/admin/login`)

      // The same site the wizard makes: installed, the administrator, the default content, the settings.
      expect(await settingOf('installed')).toBe(true)
      const admin = (
        await query<{ id: string; status: string; email: string; password_hash: string }>(
          db.url,
          `select id, status, email, password_hash from account where username = 'tor'`,
        )
      )[0]
      expect(admin).toMatchObject({ status: 'active', email: 'tor@example.test' })
      expect((await verifyPassword(password, admin?.password_hash ?? '')).valid).toBe(true)
      expect(
        await query(
          db.url,
          `select 1 from account_role ar join role r on r.id = ar.role_id where ar.account_id = $1 and r.slug = 'administrator'`,
          [admin?.id],
        ),
      ).toHaveLength(1)
      expect(await settingOf('blogname')).toBe('Min blogg')
      expect(await settingOf('locale')).toBe('nb')
      expect(await settingOf('timezone_string')).toBe('Europe/Oslo')
      expect(await settingOf('admin_email')).toBe('tor@example.test')
      expect(await settingOf('blog_public')).toBe(true)
      const titles = await query<{ title: string; type: string; status: string }>(
        db.url,
        'select title, type, status from content order by type, title',
      )
      expect(titles.map((row) => row.title)).toContain('Hei, verden!')
      expect(titles).toContainEqual({ title: 'Personvernerklæring', type: 'page', status: 'draft' })
      expect(await count('comment')).toBe(1)
      expect(await count('term', `name = 'Ukategorisert'`)).toBe(1)
      expect(await settingOf('wp_page_for_privacy_policy')).not.toBeNull()

      // The setup token is gone, the e-mail step is skipped with the notice the wizard stores, and the key has a verifier only.
      expect(await count('site_secret', `purpose = 'setup_token'`)).toBe(0)
      expect(await count('admin_notice', `key = 'setup.email_skipped'`)).toBe(1)
      const verifier = (
        await query<{ secret_hash: string }>(
          db.url,
          `select secret_hash from site_secret where purpose = 'backup_recovery_key'`,
        )
      )[0]
      expect(verifyRecoveryKey(key, verifier?.secret_hash ?? '')).toBe(true)
      expect(JSON.stringify(await query(db.url, 'select * from site_secret'))).not.toContain(key.replaceAll('-', ''))

      const audit = await query<{ action: string; source: string; actor: string; new_value: unknown }>(
        db.url,
        `select action, source, actor, new_value from audit_log where action = 'site.installed'`,
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ source: 'cli', actor: 'tor' })
      expect(JSON.stringify(audit)).not.toContain(password)
    })

    it('takes the password from standard input and then prints only the recovery key', async () => {
      const result = await toa([...INSTALL, '--admin-password-stdin', '--skip-email'], { stdin: `${GOOD_PASSWORD}\n` })
      expect(result.code).toBe(0)
      expect(result.stdout.split('\n')).toHaveLength(2)
      expect(generatedPasswordOf(result.stdout)).toBe('')
      expect(recoveryKeyOf(result.stdout)).toMatch(RECOVERY_KEY_PATTERN)
      const hash = (
        await query<{ password_hash: string }>(db.url, `select password_hash from account where username = 'tor'`)
      )[0]
      expect((await verifyPassword(GOOD_PASSWORD, hash?.password_hash ?? '')).valid).toBe(true)
      expect(JSON.stringify([result.stdout, result.stderr, result.lines])).not.toContain(GOOD_PASSWORD)
    })

    it('uses the SMTP defaults of the environment as they are: no settings saved, no notice, no test mail', async () => {
      const result = await toa([...INSTALL], { env: SMTP_ENV })
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('SMTP settings of the environment; no test mail was sent')
      expect(await settingOf('smtp_host')).toBeNull()
      expect(await count('admin_notice')).toBe(0)
      expect(await count('pgboss.job')).toBe(0)
      const audit = (
        await query<{ new_value: Record<string, unknown> }>(
          db.url,
          `select new_value from audit_log where action = 'site.installed'`,
        )
      )[0]
      expect(audit?.new_value).toMatchObject({
        emailConfigured: false,
        emailSkipped: false,
        emailFromEnvironment: true,
      })
    })

    it('refuses to install without e-mail unless --skip-email says so: exit 2 and nothing written', async () => {
      const before = await counts()
      const result = await toa([...INSTALL])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('SMTP_HOST and MAIL_FROM_ADDRESS')
      expect(result.stderr).toContain('--skip-email')
      expect(await counts()).toEqual(before)
      expect(await toa(['core', 'is-installed'])).toMatchObject({ code: 1 })
      // One of the two is not enough.
      expect((await toa([...INSTALL], { env: { SMTP_HOST: 'smtp.example.test' } })).code).toBe(2)
    })

    it('--skip-email wins over the environment and stores the notice', async () => {
      const result = await toa([...INSTALL, '--skip-email'], { env: SMTP_ENV })
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('E-mail is skipped')
      expect(await count('admin_notice', `key = 'setup.email_skipped'`)).toBe(1)
    })

    it('has defaults for the language and time zone, and takes others; --no-index turns blog_public off', async () => {
      const result = await toa([...INSTALL, '--skip-email', '--locale', 'en', '--timezone', 'UTC', '--no-index'])
      expect(result.code).toBe(0)
      expect(await settingOf('locale')).toBe('en')
      expect(await settingOf('timezone_string')).toBe('UTC')
      expect(await settingOf('blog_public')).toBe(false)
    })

    it('refuses an --url that is not PUBLIC_ORIGIN, names the one to use, and changes nothing', async () => {
      const before = await counts()
      const argv = INSTALL.map((part) => (part === ORIGIN ? 'https://other.example.test' : part))
      const result = await toa([...argv, '--skip-email'])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain(`PUBLIC_ORIGIN (${ORIGIN})`)
      expect(await counts()).toEqual(before)
      // A trailing slash and a different case of the host are the same address.
      const same = INSTALL.map((part) => (part === ORIGIN ? 'HTTPS://CMS.example.test/' : part))
      expect((await toa([...same, '--skip-email'])).code).toBe(0)
    })

    it('refuses a password equal to the username or the address', async () => {
      const result = await toa([...INSTALL, '--admin-password-stdin', '--skip-email'], { stdin: 'tor@example.test\n' })
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('must not be the username or the e-mail address')
      expect(await toa(['core', 'is-installed'])).toMatchObject({ code: 1 })
    })

    it('run again on an installed site: exit 1, «already installed», nothing changed, no secret printed', async () => {
      const first = await toa([...INSTALL, '--skip-email'])
      expect(first.code).toBe(0)
      const before = await counts()
      const verifier = await query(db.url, `select secret_hash from site_secret where purpose = 'backup_recovery_key'`)
      const again = await toa([
        ...INSTALL,
        '--skip-email',
        '--admin-user',
        'other',
        '--admin-email',
        'other@example.test',
      ])
      expect(again.code).toBe(1)
      expect(again.stdout).toBe('')
      expect(again.stderr).toContain('already installed')
      expect(await counts()).toEqual(before)
      expect(await query(db.url, `select secret_hash from site_secret where purpose = 'backup_recovery_key'`)).toEqual(
        verifier,
      )
    })

    it('two installs at once: one wins, the other exits 1, and the site has one administrator and one set of default content', async () => {
      const runs = await Promise.all(
        ['a', 'b', 'c', 'd'].map((who) =>
          toa([
            'core',
            'install',
            '--url',
            ORIGIN,
            '--title',
            `Site ${who}`,
            '--admin-user',
            `admin-${who}`,
            '--admin-email',
            `${who}@example.test`,
            '--skip-email',
          ]),
        ),
      )
      expect(runs.filter((r) => r.code === 0)).toHaveLength(1)
      expect(runs.filter((r) => r.code === 1)).toHaveLength(3)
      const winner = runs.find((r) => r.code === 0)
      expect(winner).toBeDefined()
      for (const loser of runs.filter((r) => r.code === 1)) {
        expect(loser.stdout).toBe('')
        expect(loser.stderr).toContain('already installed')
      }
      expect(await count('account')).toBe(1)
      expect(await count('content', `title = 'Hei, verden!'`)).toBe(1)
      expect(await count('comment')).toBe(1)
      expect(await count('audit_log', `action = 'site.installed'`)).toBe(1)
      expect(await count('site_secret', `purpose = 'backup_recovery_key'`)).toBe(1)
      // Only the winner's settings: the losers' titles never reached the database.
      const winnerKey = recoveryKeyOf(winner?.stdout ?? '')
      const verifier = (
        await query<{ secret_hash: string }>(
          db.url,
          `select secret_hash from site_secret where purpose = 'backup_recovery_key'`,
        )
      )[0]
      expect(verifyRecoveryKey(winnerKey, verifier?.secret_hash ?? '')).toBe(true)
      expect(String(await settingOf('blogname'))).toMatch(/^Site [a-d]$/)
    })

    it('an account that has the username rolls everything back: nothing installed, the setup token still valid', async () => {
      await toa(['user', 'create', '--username', 'tor', '--email', 'elsewhere@example.test', '--role', 'editor'])
      const token = /^Setup token: (\S+)$/m.exec((await toa(['core', 'setup-token'])).stdout)?.[1] ?? ''
      const before = await counts()
      const result = await toa([...INSTALL, '--skip-email'])
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('--admin-user: an account already has that username')
      expect(await counts()).toEqual(before)
      expect(await toa(['core', 'is-installed'])).toMatchObject({ code: 1 })
      const rows = await query<{ secret_hash: string }>(
        db.url,
        `select secret_hash from site_secret where purpose = 'setup_token'`,
      )
      expect(rows).toEqual([{ secret_hash: hashToken(token) }])
      // The address, too.
      const byMail = await toa([
        ...INSTALL.map((p) => (p === 'tor' ? 'boss' : p)),
        '--admin-email',
        'elsewhere@example.test',
        '--skip-email',
      ])
      expect(byMail.code).toBe(1)
      expect(byMail.stderr).toContain('--admin-email: an account already has that e-mail address')
    })
  })

  describe('core install, in a terminal', () => {
    function scripted(answers: Record<string, string>, secrets: string[] = []) {
      const asked: string[] = []
      const said: string[] = []
      const prompt: Prompter = {
        interactive: true,
        ask: (question, options) => {
          asked.push(question)
          if (options?.secret === true) {
            return Promise.resolve(secrets.shift() ?? '')
          }
          const key = Object.keys(answers).find((part) => question.startsWith(part))
          return Promise.resolve(key === undefined ? '' : (answers[key] ?? ''))
        },
        say: (text) => {
          said.push(text)
        },
      }
      return { prompt, asked, said }
    }

    it('asks for what the flags leave out, with defaults, and installs', async () => {
      const { prompt, asked } = scripted(
        {
          'Site address': '',
          'Site title': 'Spurt blogg',
          Language: '',
          'Time zone': '',
          'Administrator username': 'tor',
          'Administrator e-mail': 'tor@example.test',
          'Ask search engines': 'y',
          'Use the SMTP settings': 'n',
        },
        [GOOD_PASSWORD, GOOD_PASSWORD],
      )
      const result = await toa(['core', 'install'], { env: SMTP_ENV, prompt })
      expect(result.code).toBe(0)
      expect(asked.map((q) => q.split(/[[(:]/)[0]?.trim())).toEqual([
        'Site address',
        'Site title',
        'Language',
        'Time zone',
        'Administrator username',
        'Administrator e-mail address',
        'Ask search engines not to index the site?',
        'Use the SMTP settings of the environment for e-mail?',
        'Administrator password',
        'Repeat the password',
      ])
      expect(asked[0]).toContain(`[${ORIGIN}]`)
      expect(asked[2]).toContain('[nb]')
      expect(asked[3]).toContain('[Europe/Oslo]')
      expect(await settingOf('blogname')).toBe('Spurt blogg')
      expect(await settingOf('blog_public')).toBe(false)
      expect(await count('admin_notice', `key = 'setup.email_skipped'`)).toBe(1)
      // The typed password is the password; none is printed.
      expect(generatedPasswordOf(result.stdout)).toBe('')
      const hash = (
        await query<{ password_hash: string }>(db.url, `select password_hash from account where username = 'tor'`)
      )[0]
      expect((await verifyPassword(GOOD_PASSWORD, hash?.password_hash ?? '')).valid).toBe(true)
      expect(JSON.stringify([asked, result.stderr, result.lines])).not.toContain(GOOD_PASSWORD)
    })

    it('asks again after an answer that does not pass, and generates a password for an empty answer', async () => {
      const { prompt, said } = scripted({
        'Site address': 'https://wrong.example.test/path',
        'Site title': 'T',
        'Administrator username': 'tor',
        'Administrator e-mail': 'tor@example.test',
        'Ask search engines': '',
        'SMTP_HOST and MAIL_FROM_ADDRESS are not set': '',
      })
      // The address stays wrong on every try: the command gives up with the reason.
      const bad = await toa(['core', 'install'], { prompt })
      expect(bad.code).toBe(2)
      expect(said.length).toBe(5)
      expect(bad.stderr).toContain('Site address')
      expect(await toa(['core', 'is-installed'])).toMatchObject({ code: 1 })

      const ok = scripted({
        'Site address': '',
        'Site title': 'T',
        'Administrator username': 'tor',
        'Administrator e-mail': 'tor@example.test',
        'SMTP_HOST and MAIL_FROM_ADDRESS are not set': 'y',
      })
      const result = await toa(['core', 'install'], { prompt: ok.prompt })
      expect(result.code).toBe(0)
      expect(generatedPasswordOf(result.stdout)).not.toBe('')
    })

    it('asks nothing of an installed site: exit 1 at once', async () => {
      await toa([...INSTALL, '--skip-email'])
      const { prompt, asked } = scripted({})
      const result = await toa(['core', 'install'], { prompt })
      expect(result.code).toBe(1)
      expect(asked).toEqual([])
    })
  })

  describe('the real entry point', () => {
    function execNode(args: readonly string[], env: Record<string, string>, stdin = '') {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          ['--conditions=source', ENTRY, ...args],
          { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env }, timeout: 60_000 },
          (error, stdout, stderr) => {
            resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
          },
        )
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(stdin)
      })
    }

    it('installs from the environment of the container, ends by itself and keeps the secrets off stderr', async () => {
      const env = { NODE_ENV: 'production', DATABASE_URL: db.url, PUBLIC_ORIGIN: ORIGIN }
      expect((await execNode(['core', 'is-installed'], env)).code).toBe(1)
      const result = await execNode([...INSTALL, '--skip-email', '--admin-password-stdin'], env, `${GOOD_PASSWORD}\n`)
      expect(result.code).toBe(0)
      expect(recoveryKeyOf(result.stdout)).toMatch(RECOVERY_KEY_PATTERN)
      expect(result.stderr).not.toContain(recoveryKeyOf(result.stdout))
      expect(result.stderr).not.toContain(GOOD_PASSWORD)
      expect((await execNode(['core', 'is-installed'], env)).code).toBe(0)
      const again = await execNode([...INSTALL, '--skip-email', '--admin-password-stdin'], env, `${GOOD_PASSWORD}\n`)
      expect(again.code).toBe(1)
      expect(again.stdout).toBe('')
    })
  })
})
