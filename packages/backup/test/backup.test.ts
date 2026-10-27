// Backups (M1.7, K-292): one made as the app role, checked and restored as the owner, over changed data and into an empty database,
// with the content, the settings and the uploads alike afterwards; a damaged file, a wrong sha256, a hostile archive (`..`, an
// absolute path, a link) and a backup from a newer toascribe refused before anything changes; secrets only with a recipient, and
// encrypted; prune keeping the newest; and maintenance mode off again after a restore that failed.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

import { readMigrationJournal, runMigrations } from '@toascribe/db'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BackupError,
  archiveName,
  checkBackup,
  compareVersions,
  createBackup,
  discardChecked,
  isArchivePath,
  listBackups,
  pruneBackups,
  readBackup,
  readBackupConfig,
  restoreBackup,
} from '../src/index.ts'
import { tarStream } from '../src/tar-write.ts'
import { start } from '../src/tools.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped, queryAs } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('backup')

const VERSION = '0.6.0'
const logger = pino({ level: 'silent' })
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

describe('paths, names and versions', () => {
  it('takes only the names a backup holds', () => {
    for (const ok of ['manifest.json', 'database.dump', 'secrets.json', 'uploads/2026/10/fjord-3f9a1c2d.jpg']) {
      expect(isArchivePath(ok), ok).toBe(true)
    }
    for (const bad of [
      '../evil',
      '/etc/passwd',
      'uploads/../../etc/passwd',
      'uploads/a/./b',
      'uploads//a',
      'uploads/a\\b',
      'uploads/.hidden',
      'other.txt',
      'uploads/',
      `uploads/${'a'.repeat(401)}`,
    ]) {
      expect(isArchivePath(bad), bad).toBe(false)
    }
  })

  it('names a backup by its time and version, and compares versions as semver', () => {
    expect(archiveName(new Date('2026-10-28T03:00:05.123Z'), '0.6.0', false)).toBe(
      'toascribe-20261028-030005Z-0.6.0.tar.zst',
    )
    expect(archiveName(new Date('2026-10-28T03:00:05Z'), '0.6.0', true)).toMatch(/\.tar\.zst\.age$/)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0)
    expect(compareVersions('0.6.0-rc.1', '0.6.0')).toBe(-1)
  })

  it('reads the [backup] section of toascribe.toml, with defaults and named errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'toascribe-config-'))
    try {
      expect(readBackupConfig(join(dir, 'none.toml'))).toEqual({ schedule: false, keep: 7, encrypt: false })
      const file = join(dir, 'toascribe.toml')
      await writeFile(file, '[backup]\nschedule = true\nkeep = 3\n')
      expect(readBackupConfig(file)).toMatchObject({ schedule: true, keep: 3 })
      await writeFile(file, '[backup]\nencrypt = true\n')
      expect(() => readBackupConfig(file)).toThrow(/recipient/)
      await writeFile(file, '[backup]\nkeep = 0\nsecret = "x"\n')
      expect(() => readBackupConfig(file)).toThrow(/keep/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('a backup against a database (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let root: string
  let uploads: string
  let backups: string
  let identity: string
  let recipient: string
  const migration = () => {
    const last = readMigrationJournal().at(-1)
    return { tag: last?.tag ?? '', when: last?.when ?? 0 }
  }
  const owner = (sql: string, values: unknown[] = []) => queryAs(database.ownerUrl, sql, values)
  const blogname = async () =>
    ((await owner(`select value from setting where key = 'blogname'`))[0] as { value?: unknown } | undefined)?.value
  const restoreOptions = () => ({
    ownerUrl: database.ownerUrl,
    uploadsDir: uploads,
    backupsDir: backups,
    version: VERSION,
    logger,
    now: () => new Date(),
  })

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.ownerUrl, logger })
    root = await mkdtemp(join(tmpdir(), 'toascribe-backup-'))
    uploads = join(root, 'uploads')
    backups = join(root, 'backups')
    await mkdir(join(uploads, '2026', '10'), { recursive: true })
    await writeFile(join(uploads, '2026', '10', 'fjord-3f9a1c2d.jpg'), 'JPEG-BYTES')
    await writeFile(join(uploads, '2026', '10', 'fjord-3f9a1c2d-a1b2c3d4-medium.webp'), 'WEBP-BYTES')
    await writeFile(join(uploads, '.tmp-upload'), 'skipped')
    await owner(`update setting set value = '"Fjellbloggen"'::jsonb where key = 'blogname'`)
    const keyFile = join(root, 'age-key.txt')
    execFileSync('age-keygen', ['-o', keyFile], { stdio: 'ignore' })
    await chmod(keyFile, 0o600)
    identity = keyFile
    recipient = /# public key: (age1\S+)/.exec(await readFile(keyFile, 'utf8'))?.[1] ?? ''
  })

  afterAll(async () => {
    await database.drop()
    await rm(root, { recursive: true, force: true })
  })

  it('makes one file as the app role, mode 0600, with a manifest of every part and no secrets', async () => {
    const made = await createBackup({
      databaseUrl: database.appUrl,
      uploadsDir: uploads,
      backupsDir: backups,
      version: VERSION,
      migration: migration(),
      now: new Date('2026-10-28T03:00:00Z'),
    })
    expect(made.file).toMatch(/toascribe-20261028-030000Z-0\.6\.0\.tar\.zst$/)
    expect((await stat(made.file)).mode & 0o777).toBe(0o600)
    expect(made.manifest.secrets).toBe(false)
    expect(made.manifest.files.map((file) => file.path).sort()).toEqual([
      'database.dump',
      'uploads/2026/10/fjord-3f9a1c2d-a1b2c3d4-medium.webp',
      'uploads/2026/10/fjord-3f9a1c2d.jpg',
    ])
    expect(made.manifest.files.find((file) => file.path.endsWith('.jpg'))?.sha256).toBe(sha('JPEG-BYTES'))
    expect(made.skipped).toEqual(['uploads/.tmp-upload'])
    expect(await readBackup(made.file)).toEqual(made.manifest)
    // Nothing is left of the work.
    expect((await readdir(backups)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('restores over changed data: the content, the settings and the uploads are as they were', async () => {
    const [backup] = await listBackups(backups)
    if (backup === undefined) throw new Error('no backup')
    await owner(`update setting set value = '"Endret"'::jsonb where key = 'blogname'`)
    await writeFile(join(uploads, '2026', '10', 'ny-11111111.jpg'), 'NEW')
    await rm(join(uploads, '2026', '10', 'fjord-3f9a1c2d.jpg'))

    const checked = await checkBackup(backup.file, restoreOptions())
    await restoreBackup(checked, restoreOptions())
    expect(await blogname()).toBe('Fjellbloggen')
    expect(await readFile(join(uploads, '2026', '10', 'fjord-3f9a1c2d.jpg'), 'utf8')).toBe('JPEG-BYTES')
    await expect(stat(join(uploads, '2026', '10', 'ny-11111111.jpg'))).rejects.toThrow()
    // The app role has its rights back, and maintenance mode is off.
    expect(await queryAs(database.appUrl, `select count(*) from setting`)).toHaveLength(1)
    const mode = (await owner(`select value from setting where key = 'maintenance_mode'`))[0] as {
      value: { enabled: boolean }
    }
    expect(mode.value.enabled).toBe(false)
  })

  it('restores into an empty database', async () => {
    const [backup] = await listBackups(backups)
    if (backup === undefined) throw new Error('no backup')
    // As init.sql leaves it: no tables, no pg-boss, no journal.
    await owner(`drop schema pgboss cascade; drop schema drizzle cascade`)
    for (const row of (await owner(`select tablename from pg_tables where schemaname = 'public'`)) as {
      tablename: string
    }[]) {
      await owner(`drop table if exists public."${row.tablename}" cascade`)
    }
    const checked = await checkBackup(backup.file, restoreOptions())
    await restoreBackup(checked, restoreOptions())
    expect(await blogname()).toBe('Fjellbloggen')
    expect(await queryAs(database.appUrl, `select 1 from drizzle.__drizzle_migrations limit 1`)).toHaveLength(1)
  })

  it('refuses a damaged file and a wrong sha256 before anything changes', async () => {
    const [backup] = await listBackups(backups)
    if (backup === undefined) throw new Error('no backup')
    const bytes = await readFile(backup.file)
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 0xff
    const damaged = join(root, 'damaged.tar.zst')
    await writeFile(damaged, bytes)
    await expect(readBackup(damaged)).rejects.toBeInstanceOf(BackupError)

    const wrong = await craft(root, 'wrong-sha.tar.zst', [
      { name: 'database.dump', content: 'not the dump', listedSha: sha('something else') },
    ])
    await expect(checkBackup(wrong, restoreOptions())).rejects.toThrow(/sha256/)
    expect(await blogname()).toBe('Fjellbloggen')
    expect((await readdir(backups)).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('refuses a hostile archive (.., an absolute path, a link) and writes nothing outside its folder', async () => {
    for (const name of ['../evil.txt', '/tmp/evil.txt', 'uploads/../../evil.txt']) {
      const file = await craft(root, 'hostile.tar.zst', [
        { name: 'database.dump', content: 'x' },
        { name, content: 'evil', listed: false },
      ])
      await expect(checkBackup(file, restoreOptions()), name).rejects.toBeInstanceOf(BackupError)
    }
    await expect(stat(join(root, 'evil.txt'))).rejects.toThrow()
    await expect(stat(join(backups, '..', 'evil.txt'))).rejects.toThrow()

    // A symbolic link, made with the system's tar.
    const dir = join(root, 'linked')
    await mkdir(dir)
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifestFor([{ path: 'database.dump', content: 'x' }])))
    await writeFile(join(dir, 'database.dump'), 'x')
    await symlink('/etc/passwd', join(dir, 'uploads-link'))
    const plain = join(root, 'linked.tar')
    execFileSync('tar', ['-cf', plain, '-C', dir, 'manifest.json', 'uploads-link', 'database.dump'])
    execFileSync('zstd', ['-q', '-f', plain, '-o', join(root, 'linked.tar.zst')])
    await expect(checkBackup(join(root, 'linked.tar.zst'), restoreOptions())).rejects.toThrow(/SymbolicLink|files only/)
  })

  it('refuses a backup from a newer toascribe', async () => {
    const made = await createBackup({
      databaseUrl: database.appUrl,
      uploadsDir: uploads,
      backupsDir: join(root, 'newer'),
      version: '99.0.0',
      migration: migration(),
      now: new Date(),
    })
    await expect(checkBackup(made.file, restoreOptions())).rejects.toThrow(/newer than this one/)
  })

  it('keeps secrets only with a recipient, and then encrypts the whole backup', async () => {
    const secrets = { TOASCRIBE_ENCRYPTION_KEY: 'k'.repeat(44), TOASCRIBE_SIGNING_KEY: 's'.repeat(44) }
    const base = {
      databaseUrl: database.appUrl,
      uploadsDir: uploads,
      version: VERSION,
      migration: migration(),
      now: new Date(),
    }
    await expect(createBackup({ ...base, backupsDir: join(root, 'secret'), secrets })).rejects.toThrow(/recipient/)
    const made = await createBackup({ ...base, backupsDir: join(root, 'secret'), secrets, recipient })
    expect(made.file).toMatch(/\.tar\.zst\.age$/)
    expect((await readFile(made.file)).includes(Buffer.from(secrets.TOASCRIBE_SIGNING_KEY))).toBe(false)
    await expect(readBackup(made.file)).rejects.toThrow(/identity/)
    expect((await readBackup(made.file, { identity })).secrets).toBe(true)

    // Without --include-secrets the keys are nowhere in it.
    const plain = await createBackup({ ...base, backupsDir: join(root, 'plain'), now: new Date() })
    const unpacked = execFileSync('zstd', ['-q', '-d', '-c', plain.file])
    expect(unpacked.includes(Buffer.from('TOASCRIBE_SIGNING_KEY'))).toBe(false)
    expect(plain.manifest.files.some((file) => file.path === 'secrets.json')).toBe(false)
  })

  it('prunes to the newest N', async () => {
    const dir = join(root, 'prune')
    await mkdir(dir)
    for (const day of ['24', '25', '26', '27']) {
      await writeFile(join(dir, `toascribe-202610${day}-030000Z-0.6.0.tar.zst`), 'x')
    }
    await writeFile(join(dir, 'other.txt'), 'kept')
    const removed = await pruneBackups(dir, 2)
    expect(removed.map((backup) => backup.name)).toEqual([
      'toascribe-20261025-030000Z-0.6.0.tar.zst',
      'toascribe-20261024-030000Z-0.6.0.tar.zst',
    ])
    expect((await readdir(dir)).sort()).toEqual([
      'other.txt',
      'toascribe-20261026-030000Z-0.6.0.tar.zst',
      'toascribe-20261027-030000Z-0.6.0.tar.zst',
    ])
  })

  it('turns maintenance mode off again after a restore that failed', async () => {
    const [backup] = await listBackups(backups)
    if (backup === undefined) throw new Error('no backup')
    const checked = await checkBackup(backup.file, restoreOptions())
    // The dump is broken after the check: pg_restore fails in the middle of the restore.
    await writeFile(join(checked.folder, 'database.dump'), 'broken')
    await expect(restoreBackup(checked, restoreOptions())).rejects.toThrow(/pg_restore/)
    const mode = (await owner(`select value from setting where key = 'maintenance_mode'`))[0] as {
      value: { enabled: boolean }
    }
    expect(mode.value.enabled).toBe(false)
    expect(await blogname()).toBe('Fjellbloggen')
    await discardChecked(checked)
  })
})

/** A manifest for files given by their content. */
function manifestFor(files: { path: string; content: string; listedSha?: string }[]) {
  return {
    format: 1,
    toascribe: VERSION,
    migration: { tag: 'x', when: 0 },
    createdAt: new Date().toISOString(),
    secrets: false,
    files: files.map((file) => ({
      path: file.path,
      size: Buffer.byteLength(file.content),
      sha256: file.listedSha ?? sha(file.content),
    })),
  }
}

/** A hand-made archive: a manifest of the listed files, then every file as named (even names a backup never has). */
async function craft(
  dir: string,
  name: string,
  files: { name: string; content: string; listedSha?: string; listed?: boolean }[],
): Promise<string> {
  const work = await mkdtemp(join(dir, 'craft-'))
  const manifest = manifestFor(
    files
      .filter((file) => file.listed !== false)
      .map((file) => ({
        path: file.name,
        content: file.content,
        ...(file.listedSha === undefined ? {} : { listedSha: file.listedSha }),
      })),
  )
  const entries = [{ name: 'manifest.json', content: JSON.stringify(manifest) }, ...files]
  const parts = []
  for (const [index, entry] of entries.entries()) {
    const source = join(work, `part-${String(index)}`)
    await writeFile(source, entry.content)
    parts.push({ name: entry.name, source, size: Buffer.byteLength(entry.content) })
  }
  const target = join(dir, name)
  const zstd = start('zstd', ['-q', '-c', '-'])
  if (zstd.child.stdin === null || zstd.child.stdout === null) throw new Error('zstd')
  await Promise.all([
    pipeline(tarStream(parts, new Date()), zstd.child.stdin),
    pipeline(zstd.child.stdout, createWriteStream(target)),
    zstd.done,
  ])
  return target
}
