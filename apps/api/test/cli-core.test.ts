// `toa core install`, `is-installed` and `setup-token` (cli/) against the api: the real entry point runs as the app role
// (toascribe_app, DML only) on the migrated test database, and what it makes is used through the real endpoints: the
// administrator logs in, the setup routes answer 404 and the setup token it made works. The cli's own tests cover the
// arguments and refusals; this file covers what only the api can show.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { SETUP_TOKEN_HEADER, SetupStatusResponse } from '@toascribe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_ORIGIN } from './helpers.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { resetSite, setupCall } from './setup-helpers.ts'

noticeIfSkipped('cli-core')

const ENTRY = fileURLToPath(new URL('../../../cli/src/index.ts', import.meta.url))
const PASSWORD = 'a passphrase from standard input 42'

describe.skipIf(TEST_DATABASE_URL === undefined)('toa core, used through the api (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  let ipCounter = 0
  const ip = () => `198.51.100.${String(100 + (ipCounter += 1))}`

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })
  beforeEach(async () => {
    await resetSite(env)
  })

  /** Runs `toa …` the way the container does: NODE_ENV=production and the app role's DATABASE_URL, with the site's address. */
  function toa(args: readonly string[], stdin = '', extraEnv: Record<string, string> = {}) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        ['--conditions=source', ENTRY, ...args],
        {
          encoding: 'utf8',
          env: {
            PATH: process.env['PATH'] ?? '',
            NODE_ENV: 'production',
            DATABASE_URL: env.database.appUrl,
            PUBLIC_ORIGIN: TEST_ORIGIN,
            ...extraEnv,
          },
          timeout: 60_000,
        },
        (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
        },
      )
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(stdin)
    })
  }

  const install = (user = 'tor') =>
    [
      'core',
      'install',
      '--url',
      TEST_ORIGIN,
      '--title',
      'Min blogg',
      '--admin-user',
      user,
      '--admin-email',
      `${user}@example.test`,
      '--admin-password-stdin',
      '--skip-email',
    ] as const

  const status = async () =>
    SetupStatusResponse.parse(await (await env.client({ ip: ip() }).get('/api/v1/setup/status')).json())

  it('installs a complete site as the app role: the administrator logs in, the setup is closed, the content is there', async () => {
    expect(await status()).toEqual({ installed: false, nextStep: 'check' })
    expect((await toa(['core', 'is-installed'])).code).toBe(1)

    const made = await toa(install(), `${PASSWORD}\n`)
    expect(made.code).toBe(0)
    expect(made.stdout).toMatch(/^Recovery key \(shown once, keep it safe\): [0-9A-Z]{4}(-[0-9A-Z]{4}){7}\n$/)

    // The api sees the installed site at once... (the running api remembered «not installed» for a second)
    env.services.install.forgetInstalled()
    expect(await status()).toEqual({ installed: true, nextStep: null })
    expect((await toa(['core', 'is-installed'])).code).toBe(0)

    // ...the administrator logs in through the real endpoint with the password from standard input...
    const client = env.client({ ip: ip() })
    const login = await client.login('tor', PASSWORD)
    expect(login.status).toBe(200)
    expect(((await login.json()) as { status: string }).status).toBe('authenticated')
    const me = await client.get('/api/v1/me')
    expect(me.status).toBe(200)
    expect(((await me.json()) as { roles: string[] }).roles).toEqual(['administrator'])
    expect((await env.client({ ip: ip() }).login('tor', 'not the password')).status).toBe(401)

    // ...the setup is closed: every setup route but the status answers 404, token or not...
    const token = 'x'.repeat(43)
    for (const [method, path] of [
      ['GET', '/state'],
      ['GET', '/check'],
      ['POST', '/token/verify'],
      ['POST', '/recovery-key'],
    ] as const) {
      expect((await setupCall(env.client({ ip: ip() }), method, path, token)).status).toBe(404)
    }

    // ...and the default content is in the database, with the content API's rows to show for it.
    const posts = await env.query<{ title: string; status: string }>(
      `select title, status from content where type = 'post'`,
    )
    expect(posts).toEqual([{ title: 'Hei, verden!', status: 'publish' }])
    expect(await env.query('select 1 from comment')).toHaveLength(1)
    const [flag] = await env.query<{ value: unknown }>(`select value from setting where key = 'installed'`)
    expect(flag?.value).toBe(true)
  })

  it('a second run is refused with exit 1 and the administrator is the same one', async () => {
    expect((await toa(install(), `${PASSWORD}\n`)).code).toBe(0)
    const again = await toa(install('other'), `${PASSWORD}\n`)
    expect(again.code).toBe(1)
    expect(again.stdout).toBe('')
    expect(await env.query('select 1 from account')).toHaveLength(1)
  })

  it('setup-token makes a token the api accepts, replaces the earlier one, and is refused once installed', async () => {
    const early = await env.services.install.issueSetupToken()
    const made = await toa(['core', 'setup-token'])
    expect(made.code).toBe(0)
    const token = /^Setup token: (\S+)$/m.exec(made.stdout)?.[1] ?? ''
    expect(made.stdout).toContain(`Setup address: ${TEST_ORIGIN}/admin/setup#token=${token}`)

    const verify = (value: string) =>
      env.client({ ip: ip() }).request('POST', '/api/v1/setup/token/verify', {
        csrf: 'none',
        headers: { [SETUP_TOKEN_HEADER]: value },
      })
    expect((await verify(token)).status).toBe(200)
    expect((await verify(early)).status).toBe(401)

    expect((await toa(install(), `${PASSWORD}\n`)).code).toBe(0)
    const after = await toa(['core', 'setup-token'])
    expect(after.code).toBe(1)
    expect(after.stdout).toBe('')
    // The token is gone with the install.
    expect(await env.query(`select 1 from site_secret where purpose = 'setup_token'`)).toEqual([])
  })

  it('two installs at once as the app role: one site, one administrator who can log in', async () => {
    const runs = await Promise.all(['one', 'two', 'three'].map((who) => toa(install(`admin-${who}`), `${PASSWORD}\n`)))
    expect(runs.map((run) => run.code).sort()).toEqual([0, 1, 1])
    const accounts = await env.query<{ username: string }>('select username from account')
    expect(accounts).toHaveLength(1)
    env.services.install.forgetInstalled()
    expect((await env.client({ ip: ip() }).login(accounts[0]?.username ?? '', PASSWORD)).status).toBe(200)
  })

  it('register: a taken username is told (409), a taken address gets the same 202 as a free one', async () => {
    expect((await toa(install(), `${PASSWORD}\n`)).code).toBe(0)
    env.services.install.forgetInstalled()
    await env.query(`update setting set value = 'true'::jsonb where key = 'users_can_register'`)
    const taken = await env
      .client({ ip: ip() })
      .post('/api/v1/auth/register', { username: 'TOR', email: 'new@example.test' })
    expect(taken.status).toBe(409)
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('username_taken')
    const address = await env.client({ ip: ip() }).post('/api/v1/auth/register', {
      username: 'someone-new',
      email: 'tor@example.test',
    })
    expect(address.status).toBe(202)
  })
})
