// `toa user create` and `toa user reset-password` (cli/) against the api: the real entry point runs as the app role
// (toascribe_app, DML only) on the migrated test database, and the accounts it makes or changes are used through the real login
// endpoint. The cli's own tests cover its arguments and refusals; this file covers what only the api can show.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { unique } from './flows.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'

noticeIfSkipped('cli-accounts')

const ENTRY = fileURLToPath(new URL('../../../cli/src/index.ts', import.meta.url))
const NEW_PASSWORD = 'a passphrase from standard input 42'

describe.skipIf(TEST_DATABASE_URL === undefined)(
  'toa user create and reset-password, used through the api (needs TEST_DATABASE_URL)',
  () => {
    let env: AuthTestApp
    let ipCounter = 0
    const ip = () => `198.51.100.${String((ipCounter += 1))}`

    beforeAll(async () => {
      env = await startAuthApp()
    })
    afterAll(async () => {
      await env.close()
    })

    /** Runs `toa …` the way the container does: NODE_ENV=production and only DATABASE_URL, which is the app role's. */
    function toa(
      args: readonly string[],
      stdin = '',
    ): Promise<{ code: number | null; stdout: string; stderr: string }> {
      return new Promise((resolve) => {
        const child = execFile(
          process.execPath,
          ['--conditions=source', ENTRY, ...args],
          {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production', DATABASE_URL: env.database.appUrl },
            timeout: 30_000,
          },
          (error, stdout, stderr) => {
            resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
          },
        )
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(stdin)
      })
    }

    const create = (username: string, role: string) =>
      ['user', 'create', '--username', username, '--email', `${username}@example.test`, '--role', role] as const

    it.each(['administrator', 'editor', 'author', 'contributor', 'subscriber'] as const)(
      'an account made with the role %s logs in with the password it was given on standard input',
      async (role) => {
        const username = unique(`cli-${role}`)
        const made = await toa([...create(username, role), '--password-stdin'], `${NEW_PASSWORD}\n`)
        expect(made.code).toBe(0)

        const client = env.client({ ip: ip() })
        const login = await client.login(username, NEW_PASSWORD)
        expect(login.status).toBe(200)
        expect(((await login.json()) as { status: string }).status).toBe('authenticated')

        const me = await client.get('/api/v1/me')
        expect(me.status).toBe(200)
        expect(((await me.json()) as { roles: string[] }).roles).toEqual([role])
        expect((await env.client({ ip: ip() }).login(username, TEST_PASSWORD)).status).toBe(401)
      },
    )

    it('an account made with a generated password logs in with the printed one, by username or by e-mail address', async () => {
      const username = unique('cli-generated')
      const made = await toa(create(username, 'editor'))
      expect(made.code).toBe(0)
      const password = made.stdout.trim()
      expect(password).toHaveLength(24)
      expect((await env.client({ ip: ip() }).login(username, password)).status).toBe(200)
      expect((await env.client({ ip: ip() }).login(`${username}@EXAMPLE.test`, password)).status).toBe(200)
    })

    it('refuses a username or an address that an account made through the api already has, in any case', async () => {
      const existing = await env.createAccount({ username: unique('CliExisting') })
      const sameName = await toa([
        'user',
        'create',
        '--username',
        existing.username.toUpperCase(),
        '--email',
        'fresh@example.test',
        '--role',
        'editor',
      ])
      expect(sameName.code).toBe(1)
      expect(sameName.stderr).toContain('--username:')
      const sameMail = await toa([
        'user',
        'create',
        '--username',
        unique('cli-fresh'),
        '--email',
        existing.email.toUpperCase(),
        '--role',
        'editor',
      ])
      expect(sameMail.code).toBe(1)
      expect(sameMail.stderr).toContain('--email:')
    })

    it('reset-password ends the open sessions, retires the old password and the new one logs in', async () => {
      const account = await env.createAccount({ username: unique('cli-reset'), role: 'editor' })
      const first = env.client({ ip: ip() })
      const second = env.client({ ip: ip() })
      expect((await first.login(account.username, TEST_PASSWORD)).status).toBe(200)
      expect((await second.login(account.username, TEST_PASSWORD)).status).toBe(200)
      expect((await first.get('/api/v1/me')).status).toBe(200)

      const reset = await toa(
        ['user', 'reset-password', '--username', account.username, '--password-stdin'],
        `${NEW_PASSWORD}\n`,
      )
      expect(reset.code).toBe(0)

      expect((await first.get('/api/v1/me')).status).toBe(401)
      expect((await second.get('/api/v1/me')).status).toBe(401)
      expect((await env.client({ ip: ip() }).login(account.username, TEST_PASSWORD)).status).toBe(401)
      const again = env.client({ ip: ip() })
      expect((await again.login(account.username, NEW_PASSWORD)).status).toBe(200)
      expect((await again.get('/api/v1/me')).status).toBe(200)
    })

    it('reset-password with a generated password, found by e-mail address, replaces an imported WordPress hash with an Argon2id one', async () => {
      const account = await env.createAccount({
        username: unique('cli-imported'),
        passwordHash: '$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0',
      })
      expect((await env.client({ ip: ip() }).login(account.username, 'test12345')).status).toBe(200)

      const reset = await toa(['user', 'reset-password', '--email', account.email])
      expect(reset.code).toBe(0)
      const password = reset.stdout.trim()
      expect((await env.client({ ip: ip() }).login(account.username, 'test12345')).status).toBe(401)
      expect((await env.client({ ip: ip() }).login(account.username, password)).status).toBe(200)
      const [row] = await env.query<{ password_hash: string }>('select password_hash from account where id = $1', [
        account.id,
      ])
      expect(row?.password_hash).toMatch(/^\$argon2id\$/)
    })

    it('writes the audit entries as the app role', async () => {
      const username = unique('cli-audit')
      expect((await toa(create(username, 'author'))).code).toBe(0)
      expect((await toa(['user', 'reset-password', '--username', username])).code).toBe(0)
      const rows = await env.query<{ action: string; actor_type: string; actor: string; source: string }>(
        `select a.action, a.actor_type, a.actor, a.source from audit_log a
         join account u on u.id = a.object_id::uuid where u.username = $1 order by a.created_at`,
        [username],
      )
      expect(rows).toEqual([
        { action: 'account.created', actor_type: 'system', actor: 'cli', source: 'cli' },
        { action: 'password.reset', actor_type: 'system', actor: 'cli', source: 'cli' },
      ])
    })
  },
)
