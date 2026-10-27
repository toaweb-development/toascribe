// `toa post|term|menu|option`, `toa cache|jobs|secrets|shell` (M1.7, K-263 to K-265, K-270 to K-272): usage errors are exit 2; each
// command with valid input against a migrated database, through the api's own services as --user, audited with «cli»; `post
// create` refuses what the api refuses (the schema: exit 2; the rights: exit 1); no command prints a secret; the shell runs only in
// a container and at a terminal.
import { runMigrations } from '@toascribe/db'
import { createKeyRing, parseKeyMaterial, SMTP_PASSWORD_AAD } from '@toascribe/shared'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped, query } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('content commands')

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const NEW_KEY = 'f1e2d3c4b5a60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a'
const THEME = {
  slug: 'default',
  name: 'Standard',
  version: '1.0.0',
  parents: [],
  headingLevels: [2, 3],
  templates: [],
  menus: { primary: 'Hovedmeny' },
  areas: {},
  globalSets: [],
  settings: {},
}
const quiet = { prompt: { interactive: false, ask: () => Promise.resolve(''), say: () => undefined } }

describe('usage: exit 2', () => {
  it.each([
    [['post']],
    [['post', 'frob']],
    [['post', 'get', '--user', 'a']],
    [['post', 'get', 'not-a-uuid', '--user', 'a']],
    [['post', 'create', '--title', 'x', '--content', 'a', '--blocks', '[]', '--user', 'a']],
    [['post', 'create', '--title', 'x']],
    [['term', 'list', 'genre', '--user', 'a']],
    [['menu', 'nope']],
    [['option', 'add', 'x', '1']],
    [['option', 'delete', 'blogname']],
    [['option', 'update', 'blogname']],
    [['cache', 'flush', '--tag', 'not a tag']],
    [['cache', 'empty']],
    [['jobs', 'retry', 'nope']],
    [['jobs', 'list', '--state', 'lost']],
    [['secrets', 'show']],
    [['shell', '--now']],
  ])('%j', async (argv) => {
    const result = await run(argv, '0.6.0', { env: {}, logger: memoryLogger().logger, ...quiet })
    expect(result.code, result.stderr).toBe(2)
  })

  it('runs the shell only in a container, and only at a terminal', async () => {
    const outside = await run(['shell'], '0.6.0', {
      env: {},
      logger: memoryLogger().logger,
      inContainer: false,
      ...quiet,
    })
    expect(outside.code).toBe(1)
    expect(outside.stderr).toContain('only in the container')
    const noTerminal = await run(['shell'], '0.6.0', {
      env: {},
      logger: memoryLogger().logger,
      inContainer: true,
      ...quiet,
    })
    expect(noTerminal.code).toBe(2)
  })

  it('answers core version as version', async () => {
    expect(await run(['core', 'version'], '0.6.0')).toEqual({ code: 0, stdout: '0.6.0\n', stderr: '' })
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('the commands against a database (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let env: Record<string, string>
  const cli = (argv: string[], extra: Record<string, string> = {}) =>
    run(argv, '0.6.0', {
      env: { ...env, ...extra },
      logger: memoryLogger().logger,
      ...quiet,
      serviceOverrides: {
        activeTheme: { current: () => Promise.resolve(THEME) },
        embedFetch: () => Promise.reject(new Error('no network in tests')),
      },
    })

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    env = { DATABASE_URL: database.url, TOASCRIBE_ENCRYPTION_KEY: KEY, PUBLIC_ORIGIN: 'https://blogg.example.test' }
    for (const [username, role] of [
      ['redaktor', 'administrator'],
      ['bidragsyter', 'contributor'],
    ] as const) {
      const made = await run(
        [
          'user',
          'create',
          '--username',
          username,
          '--email',
          `${username}@example.test`,
          '--role',
          role,
          '--password-stdin',
        ],
        '0.6.0',
        { env, logger: memoryLogger().logger, readStdin: () => Promise.resolve('correct horse battery staple\n') },
      )
      expect(made.code, made.stderr).toBe(0)
    }
  })

  afterAll(async () => {
    await database.drop()
  })

  it('creates, reads, lists, updates and deletes a post as --user, audited with «cli»', async () => {
    const made = await cli([
      'post',
      'create',
      '--title',
      'Fra terminalen',
      '--content',
      'Første avsnitt.\n\nAndre.',
      '--format',
      'json',
      '--user',
      'redaktor',
    ])
    expect(made.code, made.stderr).toBe(0)
    const { id, blocks } = JSON.parse(made.stdout) as { id: string; blocks: unknown[] }
    expect(blocks).toHaveLength(2)
    expect((await cli(['post', 'get', id, '--user', 'redaktor'])).stdout).toContain('Fra terminalen')
    const updated = await cli(['post', 'update', id, '--status', 'publish', '--user', 'redaktor'])
    expect(updated.code, updated.stderr).toBe(0)
    const listed = await cli(['post', 'list', '--status', 'publish', '--format', 'json', '--user', 'redaktor'])
    const list = JSON.parse(listed.stdout) as { id: string; status: string }[]
    expect(list.map((row) => row.id)).toContain(id)
    expect((await cli(['post', 'delete', id, '--user', 'redaktor'])).stdout).toContain('trash')
    expect((await cli(['post', 'delete', id, '--force', '--user', 'redaktor'])).code).toBe(0)
    const audit = await query<{ actor: string; actor_type: string; source: string }>(
      database.url,
      `select distinct actor, actor_type, source from audit_log where object_type = 'post'`,
    )
    expect(audit).toEqual([{ actor: 'cli', actor_type: 'system', source: 'cli' }])
  })

  it('refuses in post create what the api refuses: the schema (exit 2) and the rights (exit 1)', async () => {
    expect((await cli(['post', 'create', '--title', 'x', '--status', 'bogus', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['post', 'create', '--title', 'x'.repeat(100_000), '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['post', 'create', '--type', 'event', '--title', 'x', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['post', 'create', '--blocks', '{"not":"a list"}', '--user', 'redaktor'])).code).toBe(2)
    // A contributor may not publish, and may not make pages.
    const publish = await cli(['post', 'create', '--title', 'Rett ut', '--status', 'publish', '--user', 'bidragsyter'])
    expect(publish.code, publish.stdout).toBe(1)
    expect((await cli(['post', 'create', '--type', 'page', '--title', 'Side', '--user', 'bidragsyter'])).code).toBe(1)
    expect((await cli(['post', 'list', '--user', 'ingen-slik'])).code).toBe(2)
  })

  it('manages categories and menus', async () => {
    const made = await cli(['term', 'create', 'category', '--name', 'Fjell', '--format', 'json', '--user', 'redaktor'])
    expect(made.code, made.stderr).toBe(0)
    const { id } = JSON.parse(made.stdout) as { id: string }
    expect((await cli(['term', 'list', 'category', '--user', 'redaktor'])).stdout).toContain('Fjell')
    expect((await cli(['term', 'update', 'category', id, '--name', 'Fjellturer', '--user', 'redaktor'])).code).toBe(0)
    expect((await cli(['term', 'create', 'category', '--name', '', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['term', 'delete', 'category', id, '--user', 'redaktor'])).code).toBe(0)
    expect((await cli(['term', 'list', 'category', '--user', 'bidragsyter'])).code).toBe(0)

    const menu = await cli(['menu', 'create', '--name', 'Hoved', '--format', 'json', '--user', 'redaktor'])
    expect(menu.code, menu.stderr).toBe(0)
    const menuId = (JSON.parse(menu.stdout) as { id: string }).id
    expect((await cli(['menu', 'list', '--user', 'redaktor'])).stdout).toContain('Hoved')
    expect((await cli(['menu', 'update', menuId, '--items', 'not json', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['menu', 'list', '--user', 'bidragsyter'])).code).toBe(1)
    expect((await cli(['menu', 'delete', menuId, '--user', 'redaktor'])).code).toBe(0)
  })

  it('reads and changes settings through their screens, and never shows the SMTP password', async () => {
    const ring = await createKeyRing({ version: 1, key: parseKeyMaterial(KEY) })
    const sealed = await ring.encrypt('smtp-hemmelig', SMTP_PASSWORD_AAD)
    await query(database.url, `update setting set value = $1::jsonb where key = 'smtp_password'`, [
      JSON.stringify(sealed),
    ])

    expect((await cli(['option', 'update', 'blogname', 'Fjellbloggen', '--user', 'redaktor'])).code).toBe(0)
    expect((await cli(['option', 'get', 'blogname', '--user', 'redaktor'])).stdout).toBe('Fjellbloggen\n')
    expect((await cli(['option', 'update', 'blog_public', 'false', '--user', 'redaktor'])).code).toBe(0)
    expect((await cli(['option', 'get', 'blog_public', '--format', 'json', '--user', 'redaktor'])).stdout).toBe(
      'false\n',
    )
    expect((await cli(['option', 'update', 'blog_public', 'kanskje', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['option', 'update', 'default_role', 'administrator', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['option', 'update', 'installed', 'true', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['option', 'update', 'no_such_key', '1', '--user', 'redaktor'])).code).toBe(2)
    expect((await cli(['option', 'update', 'blogname', 'Nei', '--user', 'bidragsyter'])).code).toBe(1)
    const list = await cli(['option', 'list', '--user', 'redaktor'])
    expect(list.stdout).toContain('[encrypted]')
    expect(list.stdout).not.toContain(sealed)
    expect(list.stdout).not.toContain('smtp-hemmelig')
  })

  it('flushes the cache, lists jobs, and refuses an unknown job', async () => {
    expect((await cli(['cache', 'flush'])).code).toBe(0)
    expect((await cli(['cache', 'flush', '--tag', 'list:post'])).code).toBe(0)
    const tags = await query<{ tag: string }>(
      database.url,
      `select tag from cache_invalidation order by id desc limit 2`,
    )
    expect(tags.map((row) => row.tag)).toEqual(['list:post', '*'])
    expect((await cli(['jobs', 'list', '--format', 'json'])).code).toBe(0)
    const missing = await cli(['jobs', 'retry', '7c9e6679-7425-40de-944b-e07fc1f90ae7'])
    expect(missing.code).toBe(1)
  })

  it('names the secrets without a value, and seals the stored ones again with a new key', async () => {
    const listed = await cli(['secrets', 'list'])
    expect(listed.code, listed.stderr).toBe(0)
    expect(listed.stdout).toContain('TOASCRIBE_ENCRYPTION_KEY')
    expect(listed.stdout).toContain('key v1')
    expect(listed.stdout).not.toContain(KEY)
    expect(listed.stdout).not.toContain(database.url)

    const steps = await cli(['secrets', 'rotate', '--new-key'])
    expect(steps.stdout).toContain('TOASCRIBE_ENCRYPTION_KEY_VERSION=2')
    expect(steps.stdout).not.toContain(KEY)

    const rotated = {
      TOASCRIBE_ENCRYPTION_KEY: NEW_KEY,
      TOASCRIBE_ENCRYPTION_KEY_VERSION: '2',
      TOASCRIBE_ENCRYPTION_OLD_KEYS: `v1:${KEY}`,
    }
    expect((await cli(['secrets', 'rotate'], rotated)).code).toBe(2) // no terminal, no --yes
    const done = await cli(['secrets', 'rotate', '--yes'], rotated)
    expect(done.code, done.stderr).toBe(0)
    expect(done.stdout).toContain('Sealed 1 secret(s) again with key version 2')
    const [row] = await query<{ value: string }>(database.url, `select value from setting where key = 'smtp_password'`)
    expect(row?.value.startsWith('v2:')).toBe(true)
    const ring = await createKeyRing({ version: 2, key: parseKeyMaterial(NEW_KEY) })
    expect(await ring.decrypt(row?.value ?? '', SMTP_PASSWORD_AAD)).toBe('smtp-hemmelig')
  })
})
