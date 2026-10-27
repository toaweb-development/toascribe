// Making a backup and reading one (M1.7, K-292). A backup is one file: a tar of `manifest.json` (first), `database.dump` (pg_dump
// -Fc), `secrets.json` (only with --include-secrets) and `uploads/…`, compressed with zstd, and encrypted with age when there are
// secrets in it or the config says so. It is written as `<name>.partial` with mode 0600 and renamed when it is whole.
//
// Reading never trusts the archive: the manifest must come first and pass its schema; every other entry must be a regular file named
// in it (isArchivePath: no absolute path, no `..`, no link of any kind), once, with its size and sha256. A reader that extracts writes
// only into a fresh folder of its own (in the backups volume), by a path it joins and checks itself, and removes it on any failure.
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { Parser } from 'tar'
import type { ReadEntry } from 'tar'

import {
  DATABASE_PATH,
  MANIFEST_PATH,
  Manifest,
  SECRETS_PATH,
  UPLOADS_PREFIX,
  archiveName,
  isArchivePath,
} from './manifest.ts'
import { tarStream } from './tar-write.ts'
import type { TarFile } from './tar-write.ts'
import { pgEnvironment, run, start } from './tools.ts'

/** The data pg_dump leaves out: live sessions (nobody is signed in after a restore) and pg-boss' jobs (old mail must not go again). */
export const EXCLUDED_DATA = ['public.session', 'pgboss.job*', 'pgboss.queue_stats*'] as const
const MAX_MANIFEST_BYTES = 256 * 1024 * 1024

export class BackupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackupError'
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Every regular file under the uploads folder, as `uploads/<key>`, and the names left out (not a key the storage makes). */
async function uploadFiles(root: string): Promise<{ files: { name: string; source: string }[]; skipped: string[] }> {
  const files: { name: string; source: string }[] = []
  const skipped: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let names: string[]
    try {
      names = (await readdir(dir)).sort()
    } catch (error) {
      if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') return
      throw error
    }
    for (const name of names) {
      const path = join(dir, name)
      const info = await lstat(path)
      const archived = `${UPLOADS_PREFIX}${relative(root, path).split(sep).join('/')}`
      if (info.isDirectory()) await walk(path)
      else if (info.isFile() && isArchivePath(archived)) files.push({ name: archived, source: path })
      else skipped.push(archived)
    }
  }
  await walk(root)
  return { files, skipped }
}

export interface CreateOptions {
  /** The database to dump: the app role is enough (SELECT on the three schemas; migration 0014 lets it read the journal). */
  readonly databaseUrl: string
  readonly uploadsDir: string
  readonly backupsDir: string
  /** The toascribe version (root package.json). */
  readonly version: string
  /** The newest migration the database has (readDatabaseMigration). */
  readonly migration: { readonly tag: string; readonly when: number }
  /** The keys to keep with it (--include-secrets); then `recipient` is required. */
  readonly secrets?: Readonly<Record<string, string>>
  /** The age public key to encrypt to: with secrets always, otherwise when `encrypt` is set. */
  readonly recipient?: string
  readonly encrypt?: boolean
  readonly now: Date
}

export interface CreatedBackup {
  readonly file: string
  readonly size: number
  readonly manifest: Manifest
  /** Files under uploads that are not keys the storage makes, left out. */
  readonly skipped: readonly string[]
}

export async function createBackup(options: CreateOptions): Promise<CreatedBackup> {
  const encrypted = options.secrets !== undefined || options.encrypt === true
  if (encrypted && options.recipient === undefined) {
    throw new BackupError(
      options.secrets === undefined
        ? 'Encryption needs [backup] recipient (an age public key) in toascribe.toml.'
        : '--include-secrets needs [backup] recipient (an age public key) in toascribe.toml: secrets are never stored unencrypted.',
    )
  }
  await mkdir(options.backupsDir, { recursive: true, mode: 0o700 })
  const work = join(options.backupsDir, `.tmp-${randomBytes(6).toString('hex')}`)
  await mkdir(work, { mode: 0o700 })
  try {
    const dump = join(work, DATABASE_PATH)
    await run(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema=public',
        '--schema=pgboss',
        '--schema=drizzle',
        ...EXCLUDED_DATA.map((table) => `--exclude-table-data=${table}`),
        `--file=${dump}`,
      ],
      pgEnvironment(options.databaseUrl),
    )
    const parts: TarFile[] = [{ name: DATABASE_PATH, source: dump, size: (await stat(dump)).size }]
    if (options.secrets !== undefined) {
      const secrets = join(work, SECRETS_PATH)
      await writeFile(secrets, `${JSON.stringify(options.secrets, null, 2)}\n`, { mode: 0o600 })
      parts.push({ name: SECRETS_PATH, source: secrets, size: (await stat(secrets)).size })
    }
    const uploads = await uploadFiles(options.uploadsDir)
    for (const file of uploads.files) parts.push({ ...file, size: (await stat(file.source)).size })

    const manifest: Manifest = {
      format: 1,
      toascribe: options.version,
      migration: { tag: options.migration.tag, when: options.migration.when },
      createdAt: options.now.toISOString(),
      secrets: options.secrets !== undefined,
      files: await Promise.all(
        parts.map(async (part) => ({ path: part.name, size: part.size, sha256: await sha256Of(part.source) })),
      ),
    }
    const manifestFile = join(work, MANIFEST_PATH)
    await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })

    const name = archiveName(options.now, options.version, encrypted)
    const target = join(options.backupsDir, name)
    const partial = join(work, `${name}.partial`)
    const out = createWriteStream(partial, { mode: 0o600 })
    const zstd = start('zstd', ['-q', '-T0', '-c', '-'])
    const age = encrypted ? start('age', ['--encrypt', '--recipient', options.recipient ?? '']) : undefined
    const files: TarFile[] = [
      { name: MANIFEST_PATH, source: manifestFile, size: (await stat(manifestFile)).size },
      ...parts,
    ]
    const stdin = zstd.child.stdin
    const zstdOut = zstd.child.stdout
    if (stdin === null || zstdOut === null) throw new BackupError('zstd did not start')
    const steps: Promise<unknown>[] = [pipeline(tarStream(files, options.now), stdin), zstd.done]
    if (age === undefined) {
      steps.push(pipeline(zstdOut, out))
    } else {
      const ageIn = age.child.stdin
      const ageOut = age.child.stdout
      if (ageIn === null || ageOut === null) throw new BackupError('age did not start')
      steps.push(pipeline(zstdOut, ageIn), pipeline(ageOut, out), age.done)
    }
    await Promise.all(steps)
    await chmod(partial, 0o600)
    await rename(partial, target)
    return { file: target, size: (await stat(target)).size, manifest, skipped: uploads.skipped }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export interface ReadOptions {
  /** The age identity file (AGE-SECRET-KEY-1…) for an encrypted archive. */
  readonly identity?: string
}

/** The archive's plain tar as a stream: age (when encrypted) and zstd undone. */
function plainTar(file: string, options: ReadOptions): { stream: NodeJS.ReadableStream; done: Promise<unknown> } {
  const encrypted = file.endsWith('.age')
  if (encrypted && options.identity === undefined) {
    throw new BackupError('The backup is encrypted: give the age identity file (--identity).')
  }
  const zstd = start('zstd', ['-q', '-d', '-c', '-'])
  const zstdIn = zstd.child.stdin
  const zstdOut = zstd.child.stdout
  if (zstdIn === null || zstdOut === null) throw new BackupError('zstd did not start')
  const steps: Promise<unknown>[] = [zstd.done]
  if (encrypted) {
    const age = start('age', ['--decrypt', '--identity', options.identity ?? ''])
    const ageIn = age.child.stdin
    const ageOut = age.child.stdout
    if (ageIn === null || ageOut === null) throw new BackupError('age did not start')
    steps.push(pipeline(createReadStream(file), ageIn), pipeline(ageOut, zstdIn), age.done)
  } else {
    steps.push(pipeline(createReadStream(file), zstdIn))
  }
  return { stream: zstdOut, done: Promise.all(steps) }
}

/**
 * Reads an archive and checks it whole. `write`, when given, is the folder each file is written to (a fresh one: nothing else is
 * touched); without it the files are only hashed. Throws BackupError on the first thing that does not match the manifest.
 */
export async function readBackup(
  file: string,
  options: ReadOptions & { readonly write?: string } = {},
): Promise<Manifest> {
  const { stream, done } = plainTar(file, options)
  let manifest: Manifest | undefined
  const seen = new Set<string>()
  const problems: string[] = []
  // One entry at a time, in the archive's order (the manifest first): the parser waits for each entry to be read before the next.
  let queue: Promise<void> = Promise.resolve()

  const target = options.write === undefined ? undefined : resolve(options.write)
  const destination = (path: string): string => {
    if (target === undefined) throw new BackupError('no target')
    const full = resolve(target, ...path.split('/'))
    if (!full.startsWith(`${target}${sep}`)) throw new BackupError(`the path of ${path} leaves the target folder`)
    return full
  }

  const handle = async (entry: ReadEntry): Promise<void> => {
    const path = entry.path
    if (entry.type !== 'File' && entry.type !== 'OldFile') {
      entry.resume()
      throw new BackupError(`the archive holds a ${entry.type} (${path.slice(0, 200)}); a backup holds files only`)
    }
    if (manifest === undefined) {
      if (path !== MANIFEST_PATH || entry.size > MAX_MANIFEST_BYTES) {
        entry.resume()
        throw new BackupError('the archive does not start with manifest.json')
      }
      const chunks: Buffer[] = []
      for await (const chunk of entry) chunks.push(chunk)
      const parsed = Manifest.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!parsed.success) throw new BackupError('manifest.json is not a toascribe manifest')
      manifest = parsed.data
      return
    }
    const listed = manifest.files.find((entryInManifest) => entryInManifest.path === path)
    if (!isArchivePath(path) || listed === undefined || seen.has(path)) {
      entry.resume()
      throw new BackupError(`the archive holds ${path.slice(0, 200)}, which its manifest does not list (or lists once)`)
    }
    seen.add(path)
    if (entry.size !== listed.size) {
      entry.resume()
      throw new BackupError(`${path} has the wrong size`)
    }
    const hash = createHash('sha256')
    const sinks: Writable[] = [hash]
    if (target !== undefined) {
      const full = destination(path)
      await mkdir(dirname(full), { recursive: true, mode: 0o700 })
      sinks.push(createWriteStream(full, { mode: 0o600, flags: 'wx' }))
    }
    const tee = new PassThrough()
    for (const sink of sinks) tee.pipe(sink)
    await pipeline(entry, tee)
    await Promise.all(
      sinks.slice(1).map(
        (sink) =>
          new Promise<void>((resolveSink, rejectSink) => {
            if (sink.writableFinished) resolveSink()
            else {
              sink.once('finish', () => {
                resolveSink()
              })
              sink.once('error', rejectSink)
            }
          }),
      ),
    )
    if (hash.digest('hex') !== listed.sha256) throw new BackupError(`${path} does not match its sha256 in the manifest`)
  }

  const parser = new Parser({
    strict: true,
    onReadEntry: (entry) => {
      queue = queue.then(async () => {
        if (problems.length > 0) {
          entry.resume()
          return
        }
        await handle(entry).catch((error: unknown) => {
          problems.push(error instanceof Error ? error.message : String(error))
          entry.resume()
        })
      })
    },
  })
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (parser.write(chunk)) callback()
      else
        parser.once('drain', () => {
          callback()
        })
    },
    final(callback) {
      parser.end(() => {
        callback()
      })
    },
  })
  try {
    await Promise.all([pipeline(stream, sink), done])
  } catch (error) {
    if (problems.length === 0) {
      throw new BackupError('the file is not a readable backup (damaged, or the wrong key)', { cause: error })
    }
  }
  await queue
  if (problems.length > 0) throw new BackupError(problems[0] ?? 'the backup does not check out')
  if (manifest === undefined) throw new BackupError('the archive holds no manifest.json')
  const missing = manifest.files.filter((entry) => !seen.has(entry.path))
  if (missing.length > 0)
    throw new BackupError(`${String(missing.length)} file(s) of the manifest are missing from the archive`)
  if (!seen.has(DATABASE_PATH)) throw new BackupError('the archive holds no database.dump')
  return manifest
}
