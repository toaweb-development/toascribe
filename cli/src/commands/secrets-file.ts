// `toa secrets export` and `toa secrets import` (M1.8, K-271; PLAN: the recovery key from the wizard seals the export). Export
// writes the keys this install reads its data with into a 0600 file, sealed with the recovery key; it refuses without the key (or
// with one that is not this install's), and never prints a value. Import opens such a file on a new server and writes the keys as
// .env lines to standard output, which must not be a terminal (`>> .env`): the values are never shown on a screen. docs/RESTORE.md
// has the whole way.
import { constants } from 'node:fs'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { getSiteSecret, schema } from '@toascribe/db'
import { SecretsFileError, openSecrets, sealSecrets, verifyRecoveryKey } from '@toascribe/install'

import { loadSecretValues, loadSecretsExportConfig } from '../config.ts'
import {
  UsageError,
  invalidInput,
  isCliResult,
  parseFlags,
  refusal,
  usageResult,
  withConfiguredDatabase,
} from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { readProcessStdin } from '../stdin.ts'
import { SECRETS_USAGE } from '../usage.ts'

/** The keys sealed: what reads the stored secrets and signs the sessions. The database passwords are made anew on a new server. */
const EXPORTED = [
  'TOASCRIBE_ENCRYPTION_KEY',
  'TOASCRIBE_ENCRYPTION_KEY_VERSION',
  'TOASCRIBE_ENCRYPTION_OLD_KEYS',
  'TOASCRIBE_SIGNING_KEY',
] as const

async function recoveryKeyFrom(options: CommandOptions, fromStdin: boolean): Promise<string> {
  if (!fromStdin) {
    throw new UsageError(
      'Give the recovery key on standard input with --recovery-key-stdin; it is never taken from the command line.',
    )
  }
  const text = (await (options.readStdin ?? readProcessStdin)()).trim()
  if (text === '') throw new UsageError('Standard input held no recovery key.')
  return text
}

/** `toa secrets export [--out <file>] --recovery-key-stdin`. */
export async function secretsExport(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let flags: ReturnType<typeof parseFlags>
  let key: string
  try {
    flags = parseFlags(args, { out: 'string', 'recovery-key-stdin': 'boolean' })
    key = await recoveryKeyFrom(options, flags['recovery-key-stdin'] === true)
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, SECRETS_USAGE)
    throw err
  }
  const outcome = await withConfiguredDatabase(
    options,
    'secrets export',
    loadSecretsExportConfig,
    async (db, _logger, config) => {
      const stored = await getSiteSecret(db, 'backup_recovery_key')
      if (stored === undefined) return refusal('This install has no recovery key yet (it is made by the setup wizard).')
      if (!verifyRecoveryKey(key, stored.secretHash))
        return refusal("That is not this install's recovery key. Nothing was written.")
      const values = loadSecretValues(options.env)
      const secrets = Object.fromEntries(
        EXPORTED.flatMap((name) => (values[name] === undefined ? [] : [[name, values[name]]])),
      )
      if (secrets['TOASCRIBE_ENCRYPTION_KEY'] === undefined)
        return invalidInput('TOASCRIBE_ENCRYPTION_KEY is not set here.')
      const now = new Date()
      const target =
        typeof flags['out'] === 'string'
          ? resolve(flags['out'])
          : join(config.BACKUPS_DIR, `toascribe-secrets-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z.json`)
      if (!isAbsolute(target)) return invalidInput('--out must be a path.')
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      // 0600, and never over a file that is there: an export does not replace another.
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600).catch(
        (err: unknown) => {
          if (typeof err === 'object' && err !== null && Reflect.get(err, 'code') === 'EEXIST') return undefined
          throw err
        },
      )
      if (handle === undefined) return refusal('A file with that name is already there. Nothing was written.')
      try {
        await handle.writeFile(sealSecrets(secrets, key, now), 'utf8')
      } finally {
        await handle.close()
      }
      await db.insert(schema.auditLog).values({
        actorType: 'system',
        actor: 'cli',
        accountId: null,
        action: 'secrets.exported',
        objectType: 'system',
        objectId: 'secrets',
        newValue: { names: Object.keys(secrets).sort() },
        source: 'cli',
        ip: null,
      })
      return target
    },
  )
  if (isCliResult(outcome)) return outcome
  return {
    code: 0,
    stdout: `The keys are sealed with the recovery key in ${outcome} (mode 0600). Copy it off the server with the backups.\n`,
    stderr: '',
  }
}

/**
 * `toa secrets import <file> --recovery-key-stdin >> .env`, or `toa secrets import - --recovery-key-stdin`: then standard input is the
 * recovery key on its first line and the file after it (`cat key.txt secrets.json | … import - …`), so the file never has to be
 * copied into the container (a file `docker compose cp` puts there belongs to root, and the api user could not read it).
 *
 * The guard against a terminal sees only the container's own standard output: through `docker compose run -T` (or `exec -T`) it is
 * never a terminal, and the lines go wherever the host sends them. The command must end with `>> .env` (docs/RESTORE.md).
 */
export async function secretsImport(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const [file, ...rest] = args
  let input: string
  try {
    if (file === undefined || (file.startsWith('--') && file !== '-'))
      throw new UsageError('Give the secrets file (or -) after import.')
    const flags = parseFlags(rest, { 'recovery-key-stdin': 'boolean' })
    if (flags['recovery-key-stdin'] !== true) {
      throw new UsageError(
        'Give the recovery key on standard input with --recovery-key-stdin; it is never taken from the command line.',
      )
    }
    input = await (options.readStdin ?? readProcessStdin)()
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, SECRETS_USAGE)
    throw err
  }
  if (options.stdoutIsTerminal ?? process.stdout.isTTY) {
    return invalidInput(
      'The keys are written as .env lines to standard output, never to a screen: end the command with `>> docker/.env`.',
    )
  }
  const newline = input.indexOf('\n')
  const key = (file === '-' && newline !== -1 ? input.slice(0, newline) : input).trim()
  if (key === '') return usageResult('Standard input held no recovery key.', SECRETS_USAGE)
  let text: string
  if (file === '-') {
    if (newline === -1)
      return usageResult('After the recovery key line, standard input must hold the secrets file.', SECRETS_USAGE)
    text = input.slice(newline + 1)
  } else {
    try {
      text = await readFile(resolve(file), 'utf8')
    } catch (err) {
      const code: unknown = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined
      return refusal(
        code === 'EACCES'
          ? 'The file cannot be read by the api user (EACCES). Give it on standard input instead: import - (docs/RESTORE.md).'
          : `The file cannot be read (${typeof code === 'string' ? code : 'error'}).`,
      )
    }
  }
  try {
    const { secrets, createdAt } = openSecrets(text, key)
    const lines = Object.entries(secrets).map(([name, value]) => `${name}=${value}`)
    return {
      code: 0,
      // A blank line first: a .env without a final newline would glue the comment onto its last line.
      stdout: `\n# toascribe secrets, exported ${createdAt}, imported ${new Date().toISOString()}\n${lines.join('\n')}\n`,
      stderr: `Wrote ${String(lines.length)} keys (${Object.keys(secrets).sort().join(', ')}) as .env lines.\n`,
    }
  } catch (err) {
    if (err instanceof SecretsFileError) return refusal(err.message)
    throw err
  }
}
