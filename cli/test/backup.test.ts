// `toa backup …`, `toa db migrate` and `toa core update` (M1.7, K-292, K-293): usage errors are exit 2; create, list, verify, prune
// and restore against a migrated database, each with an audit entry by the CLI; a restore asks (or takes --yes) and --dry-run changes
// nothing; --include-secrets without a recipient is refused; a migration stops when the backup before it fails, and --no-backup
// runs it with a warning.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMigrations } from '@toascribe/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped, query } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('backup')

describe('toa backup, db migrate: usage', () => {
  it.each([
    [['backup']],
    [['backup', 'snart']],
    [['backup', 'create', '--format', 'xml']],
    [['backup', 'verify']],
    [['backup', 'restore']],
    [['backup', 'prune', '--keep', '0']],
    [['backup', 'create', '--secrets']],
    [['db', 'migrate', '--force']],
  ])('%j is exit 2', async (argv) => {
    const result = await run(argv, '1.2.3', { env: {}, logger: memoryLogger().logger })
    expect(result.code).toBe(2)
  })

  it('needs the owner role for a restore, and says where to run it', async () => {
    const result = await run(['backup', 'restore', 'x.tar.zst'], '1.2.3', {
      env: { DATABASE_URL: 'postgres://a:b@localhost/x' },
      logger: memoryLogger().logger,
    })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('migrate service')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('toa backup against a database (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let root: string
  let env: Record<string, string>
  const cli = (argv: string[], extra: Record<string, string> = {}, interactive?: { answer: string }) =>
    run(argv, '1.2.3', {
      env: { ...env, ...extra },
      logger: memoryLogger().logger,
      ...(interactive === undefined
        ? { prompt: { interactive: false, ask: () => Promise.resolve(''), say: () => undefined } }
        : { prompt: { interactive: true, ask: () => Promise.resolve(interactive.answer), say: () => undefined } }),
    })
  const blogname = async () =>
    (await query<{ value: unknown }>(database.url, `select value from setting where key = 'blogname'`))[0]?.value

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    root = await mkdtemp(join(tmpdir(), 'toascribe-cli-backup-'))
    await mkdir(join(root, 'uploads', '2026', '10'), { recursive: true })
    await writeFile(join(root, 'uploads', '2026', '10', 'bilde-12345678.jpg'), 'BILDE')
    env = {
      DATABASE_URL: database.url,
      MIGRATION_DATABASE_URL: database.url,
      UPLOADS_DIR: join(root, 'uploads'),
      BACKUPS_DIR: join(root, 'backups'),
      TOASCRIBE_CONFIG_FILE: join(root, 'toascribe.toml'),
      TOASCRIBE_SIGNING_KEY: 'hemmelig-signeringsnokkel',
    }
    await query(database.url, `update setting set value = '"Fjellbloggen"'::jsonb where key = 'blogname'`)
  })

  afterAll(async () => {
    await database.drop()
    await rm(root, { recursive: true, force: true })
  })

  it('makes, lists and verifies a backup, records its status and an audit entry', async () => {
    const made = await cli(['backup', 'create', '--format', 'json'])
    expect(made.code, made.stderr).toBe(0)
    const { file } = JSON.parse(made.stdout) as { file: string }
    expect((await cli(['backup', 'list'])).stdout).toContain(file)
    const verified = await cli(['backup', 'verify', file])
    expect(verified.code).toBe(0)
    expect(verified.stdout).toContain('checks out')
    const status = (
      await query<{ value: { ok: boolean; file: string } }>(
        database.url,
        `select value from setting where key = 'backup_status'`,
      )
    )[0]?.value
    expect(status).toMatchObject({ ok: true, file })
    const audit = await query<{ action: string; actor: string }>(
      database.url,
      `select action, actor from audit_log where object_type = 'backup'`,
    )
    expect(audit).toContainEqual({ action: 'backup.created', actor: 'cli' })
    expect((await cli(['backup', 'verify', 'toascribe-20000101-000000Z-0.0.1.tar.zst'])).code).toBe(2)
  })

  it('refuses --include-secrets without a recipient, and keeps no secret in a backup without it', async () => {
    const refused = await cli(['backup', 'create', '--include-secrets'])
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('recipient')
    const status = (
      await query<{ value: { ok: boolean; error: string } }>(
        database.url,
        `select value from setting where key = 'backup_status'`,
      )
    )[0]?.value
    expect(status?.ok).toBe(false)
  })

  it('restores only with a confirmation; --dry-run changes nothing', async () => {
    const [latest] = JSON.parse((await cli(['backup', 'list', '--format', 'json'])).stdout) as { name: string }[]
    const name = latest?.name ?? ''
    await query(database.url, `update setting set value = '"Endret"'::jsonb where key = 'blogname'`)

    const dry = await cli(['backup', 'restore', name, '--dry-run'])
    expect(dry.code, dry.stderr).toBe(0)
    // Its origin is told; made here, so no warning (M1.8, Tor's decision).
    expect(dry.stdout).toMatch(/Origin: made .* by toascribe \d+\.\d+\.\d+ on the host "/)
    expect(dry.stdout).not.toContain('WARNING')
    const saved = await query<{ value: unknown }>(database.url, `select value from setting where key = 'backup_log'`)
    await query(database.url, `update setting set value = '[]'::jsonb where key = 'backup_log'`)
    expect((await cli(['backup', 'restore', name, '--dry-run'])).stdout).toContain(
      'WARNING: this backup is not in the list',
    )
    await query(database.url, `update setting set value = $1::jsonb where key = 'backup_log'`, [
      JSON.stringify(saved[0]?.value),
    ])
    expect(await blogname()).toBe('Endret')
    expect((await cli(['backup', 'restore', name])).code).toBe(2) // no terminal, no --yes
    expect((await cli(['backup', 'restore', name], {}, { answer: 'nei' })).code).toBe(1)
    expect(await blogname()).toBe('Endret')

    const restored = await cli(['backup', 'restore', name], {}, { answer: 'gjenopprett' })
    expect(restored.code, restored.stderr).toBe(0)
    expect(await blogname()).toBe('Fjellbloggen')
    const audit = await query<{ action: string }>(
      database.url,
      `select action from audit_log where action = 'backup.restored'`,
    )
    expect(audit).toHaveLength(1)
  })

  it('prunes to --keep', async () => {
    await cli(['backup', 'create'])
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await cli(['backup', 'create'])
    const pruned = await cli(['backup', 'prune', '--keep', '1'])
    expect(pruned.code).toBe(0)
    expect(JSON.parse((await cli(['backup', 'list', '--format', 'json'])).stdout)).toHaveLength(1)
  })

  it('stops a migration when the backup before it fails, and runs it with --no-backup and a warning', async () => {
    // The newest migration forgotten: it is pending again (it only grants, so it runs twice without harm).
    await query(
      database.url,
      `delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`,
    )
    const count = async () =>
      Number((await query<{ n: string }>(database.url, `select count(*) as n from drizzle.__drizzle_migrations`))[0]?.n)
    const before = await count()

    // A backups folder that cannot be made (under a file): the backup fails.
    await writeFile(join(root, 'en-fil'), 'x')
    const blocked = await cli(['db', 'migrate'], { BACKUPS_DIR: join(root, 'en-fil', 'kopier') })
    expect(blocked.code).toBe(1)
    expect(blocked.stderr).toContain('did not run')
    expect(await count()).toBe(before)

    const forced = await cli(['core', 'update', '--no-backup'])
    expect(forced.code, forced.stderr).toBe(0)
    expect(forced.stdout).toContain('WARNING: --no-backup')
    expect(await count()).toBe(before + 1)
    expect((await cli(['db', 'migrate'])).stdout).toBe('The database is up to date.\n')
  })
})
