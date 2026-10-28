// `toa backup create|list|verify|prune|restore`, `toa db migrate` and `toa core update` (M1.7, K-292, K-293).
//   create, list, verify, prune: in the api container, as the app role (DATABASE_URL).
//   restore, db migrate, core update: as the owner role, in the migrate service (`docker compose run --rm migrate toa …`).
// A backup is never made with secrets unless --include-secrets says so, and then only encrypted to the [backup] recipient in
// toascribe.toml. A restore asks before it changes anything (or takes --yes), and --dry-run checks the file and stops.
import { resolve } from 'node:path'

import {
  BackupConfigError,
  BackupError,
  ToolError,
  checkBackup,
  findBackup,
  listBackups,
  pruneBackups,
  readBackup,
  readBackupConfig,
  restoreBackup,
  takeBackup,
  readBackupLog,
} from '@toascribe/backup'
import {
  createDb,
  getMigrationStatus,
  readMaintenanceMode,
  runMigrations,
  schema,
  setMaintenanceMode,
} from '@toascribe/db'
import type { JsonObject } from '@toascribe/shared'
import type { Logger } from 'pino'
import { z } from 'zod'

import { ConfigError, loadBackupConfig, loadOwnerBackupConfig, loadSecretValues } from '../config.ts'
import type { BackupConfig, OwnerBackupConfig } from '../config.ts'
import { UsageError, failureFields, invalidInput, loggerFor, parseFlags, refusal, usageResult } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import { createTerminalPrompter } from '../prompt.ts'
import type { CliResult } from '../result.ts'
import { readVersion } from '../version.ts'
import { BACKUP_USAGE, DB_MIGRATE_USAGE } from '../usage.ts'

const { auditLog } = schema
const Format = z.enum(['table', 'json'])

/** The file a command names: a name in the backups folder, or a path (with a `/`). */
function fileArgument(args: readonly string[]): { file: string | undefined; rest: string[] } {
  const [first, ...rest] = args
  return first === undefined || first.startsWith('--') ? { file: undefined, rest: [...args] } : { file: first, rest }
}

async function resolveFile(backupsDir: string, file: string): Promise<string> {
  if (file.includes('/')) return resolve(file)
  const found = await findBackup(backupsDir, file)
  if (found === undefined)
    throw new UsageError(`There is no backup named ${file} in the backups folder (toa backup list).`)
  return found.file
}

function formatOf(flags: Readonly<Record<string, unknown>>): 'table' | 'json' {
  if (flags['format'] === undefined) return 'table'
  const parsed = Format.safeParse(flags['format'])
  if (!parsed.success) throw new UsageError('--format is table or json.')
  return parsed.data
}

/** An audit entry by the CLI, in its own connection (a restore replaces the database it would otherwise be in). */
async function audit(databaseUrl: string, action: string, newValue: JsonObject): Promise<void> {
  const { db, pool } = createDb({ connectionString: databaseUrl, max: 1, applicationName: 'toascribe-cli' })
  try {
    await db.insert(auditLog).values({
      actorType: 'system',
      actor: 'cli',
      accountId: null,
      action,
      objectType: 'backup',
      newValue,
      source: 'cli',
      ip: null,
      createdAt: new Date(),
    })
  } finally {
    await pool.end()
  }
}

/** What a failure is to the person at the terminal: a usage problem (2) or a run that failed (1), never a stack. */
function failed(err: unknown, logger: Logger, command: string): CliResult {
  if (err instanceof UsageError || err instanceof BackupConfigError || err instanceof ConfigError) {
    return invalidInput(err.message)
  }
  if (err instanceof BackupError || err instanceof ToolError) {
    logger.error(failureFields(err), `${command} failed`)
    return refusal(`${command} failed: ${err.message}`)
  }
  logger.fatal(failureFields(err), `${command} failed`)
  return refusal(`${command} failed; see the log above`)
}

/** Makes a backup (as the role in `databaseUrl`) and records its status. */
export function makeBackup(
  config: {
    readonly databaseUrl: string
    readonly UPLOADS_DIR: string
    readonly BACKUPS_DIR: string
    readonly TOASCRIBE_CONFIG_FILE: string
  },
  options: { readonly includeSecrets: boolean; readonly env: CommandOptions['env'] },
) {
  return takeBackup({
    databaseUrl: config.databaseUrl,
    uploadsDir: config.UPLOADS_DIR,
    backupsDir: config.BACKUPS_DIR,
    configFile: config.TOASCRIBE_CONFIG_FILE,
    version: readVersion(),
    now: new Date(),
    ...(options.includeSecrets ? { secrets: loadSecretValues(options.env) } : {}),
  })
}

export async function backup(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [action, ...rest] = args
  switch (action) {
    case 'create':
      return backupCreate(rest, options)
    case 'list':
      return backupList(rest, options)
    case 'verify':
      return backupVerify(rest, options)
    case 'prune':
      return backupPrune(rest, options)
    case 'restore':
      return backupRestore(rest, options)
    default:
      return usageResult('Say create, list, verify, prune or restore.', BACKUP_USAGE)
  }
}

function appConfig(options: CommandOptions): BackupConfig {
  return loadBackupConfig(options.env)
}

async function backupCreate(args: readonly string[], options: CommandOptions): Promise<CliResult> {
  let flags: Readonly<Record<string, unknown>>
  let config: BackupConfig
  try {
    flags = parseFlags(args, { 'include-secrets': 'boolean', format: 'string' })
    formatOf(flags)
    config = appConfig(options)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, BACKUP_USAGE)
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  try {
    const made = await makeBackup(
      { ...config, databaseUrl: config.DATABASE_URL },
      { includeSecrets: flags['include-secrets'] === true, env: options.env },
    )
    await audit(config.DATABASE_URL, 'backup.created', {
      file: made.file.split('/').pop() ?? '',
      size: made.size,
      secrets: made.manifest.secrets,
    })
    const name = made.file.split('/').pop() ?? made.file
    const skipped =
      made.skipped.length === 0 ? '' : `Left out (not files the media library made): ${String(made.skipped.length)}\n`
    return formatOf(flags) === 'json'
      ? { code: 0, stdout: `${JSON.stringify({ file: name, size: made.size, manifest: made.manifest })}\n`, stderr: '' }
      : {
          code: 0,
          stdout: `Backup made: ${name} (${String(made.size)} bytes, ${String(made.manifest.files.length)} files${made.manifest.secrets ? ', with the keys, encrypted' : ''}).\n${skipped}`,
          stderr: '',
        }
  } catch (err) {
    return failed(err, logger, 'backup create')
  }
}

async function backupList(args: readonly string[], options: CommandOptions): Promise<CliResult> {
  let format: 'table' | 'json'
  let config: BackupConfig
  try {
    format = formatOf(parseFlags(args, { format: 'string' }))
    config = appConfig(options)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, BACKUP_USAGE)
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const backups = await listBackups(config.BACKUPS_DIR)
  if (format === 'json') {
    return {
      code: 0,
      stdout: `${JSON.stringify(backups.map(({ name, size, modifiedAt, encrypted }) => ({ name, size, modifiedAt, encrypted })))}\n`,
      stderr: '',
    }
  }
  const lines = backups.map(
    (entry) =>
      `${entry.name}  ${String(entry.size)} bytes  ${entry.modifiedAt.toISOString()}${entry.encrypted ? '  encrypted' : ''}`,
  )
  return { code: 0, stdout: lines.length === 0 ? 'No backups.\n' : `${lines.join('\n')}\n`, stderr: '' }
}

async function backupVerify(args: readonly string[], options: CommandOptions): Promise<CliResult> {
  const { file, rest } = fileArgument(args)
  let flags: Readonly<Record<string, unknown>>
  let config: BackupConfig
  try {
    if (file === undefined) throw new UsageError('Name the backup: toa backup verify <file>.')
    flags = parseFlags(rest, { identity: 'string', format: 'string' })
    formatOf(flags)
    config = appConfig(options)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, BACKUP_USAGE)
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  try {
    const path = await resolveFile(config.BACKUPS_DIR, file)
    const identity = flags['identity']
    const manifest = await readBackup(path, typeof identity === 'string' ? { identity: resolve(identity) } : {})
    return formatOf(flags) === 'json'
      ? { code: 0, stdout: `${JSON.stringify({ ok: true, manifest })}\n`, stderr: '' }
      : {
          code: 0,
          stdout: `The backup checks out: toascribe ${manifest.toascribe}, migration ${manifest.migration.tag}, ${String(manifest.files.length)} files, made ${manifest.createdAt}.\n`,
          stderr: '',
        }
  } catch (err) {
    return failed(err, logger, 'backup verify')
  }
}

async function backupPrune(args: readonly string[], options: CommandOptions): Promise<CliResult> {
  let keep: number | undefined
  let config: BackupConfig
  try {
    const flags = parseFlags(args, { keep: 'string' })
    if (flags['keep'] !== undefined) {
      const parsed = z.coerce.number().int().min(1).max(365).safeParse(flags['keep'])
      if (!parsed.success) throw new UsageError('--keep is a number from 1 to 365.')
      keep = parsed.data
    }
    config = appConfig(options)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, BACKUP_USAGE)
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  try {
    const settings = readBackupConfig(config.TOASCRIBE_CONFIG_FILE)
    const removed = await pruneBackups(config.BACKUPS_DIR, keep ?? settings.keep)
    if (removed.length > 0)
      await audit(config.DATABASE_URL, 'backup.pruned', { removed: removed.map((entry) => entry.name) })
    return {
      code: 0,
      stdout:
        removed.length === 0 ? 'Nothing to remove.\n' : `Removed: ${removed.map((entry) => entry.name).join(', ')}\n`,
      stderr: '',
    }
  } catch (err) {
    return failed(err, logger, 'backup prune')
  }
}

async function backupRestore(args: readonly string[], options: CommandOptions): Promise<CliResult> {
  const { file, rest } = fileArgument(args)
  let flags: Readonly<Record<string, unknown>>
  let config: OwnerBackupConfig
  try {
    if (file === undefined) throw new UsageError('Name the backup: toa backup restore <file>.')
    flags = parseFlags(rest, { identity: 'string', 'dry-run': 'boolean', yes: 'boolean' })
    config = loadOwnerBackupConfig(options.env)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, BACKUP_USAGE)
    if (err instanceof ConfigError)
      return invalidInput(
        `${err.message} (run it in the migrate service: docker compose run --rm migrate toa backup restore …)`,
      )
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  const restoreOptions = {
    ownerUrl: config.MIGRATION_DATABASE_URL,
    uploadsDir: config.UPLOADS_DIR,
    backupsDir: config.BACKUPS_DIR,
    version: readVersion(),
    logger,
    now: () => new Date(),
    ...(typeof flags['identity'] === 'string' ? { identity: resolve(flags['identity']) } : {}),
  }
  try {
    const path = await resolveFile(config.BACKUPS_DIR, file)
    const checked = await checkBackup(path, restoreOptions)
    const { manifest } = checked
    const summary = `toascribe ${manifest.toascribe}, migration ${manifest.migration.tag}, ${String(manifest.files.length)} files, made ${manifest.createdAt}`
    // Where it comes from (M1.8, Tor's decision): the manifest's origin, and a warning when this install did not make it. The sha256s
    // prove the file is whole, not who made it (AGENTS.md «Known deviations»).
    const madeHere = await madeByThisInstall(
      config.MIGRATION_DATABASE_URL,
      path.split('/').pop() ?? '',
      manifest.createdAt,
    )
    const origin =
      `Origin: made ${manifest.createdAt} by toascribe ${manifest.toascribe}` +
      `${manifest.origin === undefined ? ' (no host name: made before 0.7)' : ` on the host ${JSON.stringify(manifest.origin.host)}`}.\n` +
      (madeHere
        ? ''
        : 'WARNING: this backup is not in the list of backups made by this install. Restore it only if you know where it comes from.\n')
    if (flags['dry-run'] === true) {
      return {
        code: 0,
        stdout: `${origin}The backup checks out and can be restored: ${summary}. Nothing was changed.\n`,
        stderr: '',
      }
    }
    if (flags['yes'] !== true) {
      const prompt = options.prompt ?? createTerminalPrompter()
      if (!prompt.interactive) {
        return invalidInput('A restore replaces the whole site. Run it in a terminal to confirm, or add --yes.')
      }
      prompt.say(origin)
      const answer = await prompt.ask(
        `This replaces the database and the uploads with the backup (${summary}). Type «gjenopprett» to go on: `,
      )
      if (answer.trim() !== 'gjenopprett') return refusal('Nothing was changed.')
    }
    const restored = await restoreBackup(checked, restoreOptions)
    await audit(config.MIGRATION_DATABASE_URL, 'backup.restored', {
      file: path.split('/').pop() ?? '',
      toascribe: manifest.toascribe,
      migration: manifest.migration.tag,
    })
    const secrets =
      restored.secretsFile === undefined
        ? ''
        : `The backup held the keys: they are in ${restored.secretsFile} (mode 0600). Put them in .env, restart, and delete the file.\n`
    return { code: 0, stdout: `${flags['yes'] === true ? origin : ''}Restored: ${summary}.\n${secrets}`, stderr: '' }
  } catch (err) {
    return failed(err, logger, 'backup restore')
  }
}

/**
 * `toa db migrate [--no-backup]` and `toa core update`: the migrations this build has, with a backup first when they change
 * something in a site that has data (K-293), and maintenance mode while they run. A failed backup stops it before anything changes.
 */
/** 3F000 (no schema drizzle) or 42P01 (no journal table): the database has never been migrated. */
function isMissingJournal(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code: unknown = Reflect.get(current, 'code')
    if (code === '3F000' || code === '42P01') return true
    current = current.cause
  }
  return false
}

export async function dbMigrate(
  args: readonly string[],
  options: CommandOptions = {},
  command = 'db migrate',
): Promise<CliResult> {
  let flags: Readonly<Record<string, unknown>>
  let config: OwnerBackupConfig
  try {
    flags = parseFlags(args, { 'no-backup': 'boolean' })
    config = loadOwnerBackupConfig(options.env)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, DB_MIGRATE_USAGE)
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  const ownerUrl = config.MIGRATION_DATABASE_URL
  const { db, pool } = createDb({ connectionString: ownerUrl, max: 1, applicationName: 'toascribe-cli' })
  let status: { upToDate: boolean; applied: number }
  try {
    // Only a database without the journal yet (a first start) counts as empty; any other error stops here, before anything runs.
    status = await getMigrationStatus(db).catch((error: unknown) => {
      if (isMissingJournal(error)) return { upToDate: false, applied: 0 }
      throw error
    })
  } catch (err) {
    return failed(err, logger, `${command} (reading the migration status)`)
  } finally {
    await pool.end()
  }
  if (status.upToDate) return { code: 0, stdout: 'The database is up to date.\n', stderr: '' }

  const lines: string[] = []
  const hasData = status.applied > 0
  if (hasData) {
    if (flags['no-backup'] === true) {
      lines.push(
        'WARNING: --no-backup: the migrations run without a backup first. A failure cannot be undone from one.',
      )
    } else {
      try {
        const made = await makeBackup({ ...config, databaseUrl: ownerUrl }, { includeSecrets: false, env: options.env })
        lines.push(`Backup made before the migrations: ${made.file.split('/').pop() ?? made.file}.`)
      } catch (err) {
        const result = failed(err, logger, `${command} (the backup before the migrations)`)
        return { ...result, code: 1, stderr: `${result.stderr}The migrations did not run.\n` }
      }
    }
  }
  const setMode = async (enabled: boolean, wasOn: boolean) => {
    if (!hasData) return
    const handle = createDb({ connectionString: ownerUrl, max: 1, applicationName: 'toascribe-cli' })
    try {
      await handle.db.transaction(async (tx) => {
        await setMaintenanceMode(tx, enabled ? { enabled: true } : { enabled: wasOn }, new Date())
      })
    } catch (err) {
      logger.warn(failureFields(err), 'maintenance mode could not be set')
    } finally {
      await handle.pool.end()
    }
  }
  let wasOn = false
  if (hasData) {
    const handle = createDb({ connectionString: ownerUrl, max: 1, applicationName: 'toascribe-cli' })
    try {
      wasOn = (await readMaintenanceMode(handle.db)).enabled
    } catch {
      wasOn = false
    } finally {
      await handle.pool.end()
    }
  }
  try {
    await setMode(true, wasOn)
    await runMigrations({ connectionString: ownerUrl, logger })
    lines.push('Migrations done.')
    return { code: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  } catch (err) {
    logger.fatal(failureFields(err), `${command} failed`)
    return refusal(`${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${command} failed; see the log above`)
  } finally {
    await setMode(false, wasOn)
  }
}

/** Whether the backup is in `backup_log` of the database as it is now (false when it cannot be read: then the warning shows). */
async function madeByThisInstall(ownerUrl: string, file: string, createdAt: string): Promise<boolean> {
  const { db, pool } = createDb({ connectionString: ownerUrl, max: 1, applicationName: 'toascribe-cli' })
  try {
    const log = await readBackupLog(db)
    return log.some((made) => made.file === file && made.createdAt === createdAt)
  } catch {
    return false
  } finally {
    await pool.end()
  }
}
