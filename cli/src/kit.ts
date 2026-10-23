// What the commands share: reading flags, the one-line refusals and usage errors, the password from standard input or a new
// one, and a one-connection database as the app role. The commands themselves are in commands/. Nothing here prints; every
// function returns a CliResult or throws, so the tests call the commands without process I/O.
import { parseArgs } from 'node:util'

import { createDb } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { NewPassword, generatePassword } from '@toascribe/shared'
import { pino } from 'pino'
import type { Logger } from 'pino'
import type { z } from 'zod'

import { ConfigError, loadAppDatabaseConfig } from './config.ts'
import type { AppDatabaseConfig, EnvSource } from './config.ts'
import type { CommandOptions } from './options.ts'
import type { CliResult } from './result.ts'
import { StdinTooLongError } from './stdin.ts'

export type FlagKind = 'string' | 'boolean'

export type FlagValues = Readonly<Record<string, string | boolean | undefined>>

/** A usage problem: a bad flag or value (exit code 2). The message names flags and rules, never values. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/**
 * Reads `--flag value` pairs. Unknown options are reported by name only, and a stray argument is not echoed: people try
 * `--password hunter2`, and the value must not come back in a message.
 */
export function parseFlags(args: readonly string[], spec: Readonly<Record<string, FlagKind>>): FlagValues {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: Object.fromEntries(Object.entries(spec).map(([name, type]) => [name, { type }])),
    strict: false,
    allowPositionals: true,
  })
  const problems: string[] = []
  for (const name of Object.keys(values)) {
    if (!(name in spec)) {
      problems.push(
        name === 'password' || name === 'pw'
          ? `Unknown option --${name}. A password is never taken from the command line: use --password-stdin.`
          : `Unknown option --${name}.`,
      )
    }
  }
  if (positionals.length > 0) {
    problems.push('Unexpected argument. Every value follows its flag, as --flag value.')
  }
  for (const [name, kind] of Object.entries(spec)) {
    const value = values[name]
    if (value === undefined) {
      continue
    }
    // `--username --email x` gives the username the value "--email": a value that looks like a flag is a missing value.
    if (kind === 'string' && (typeof value !== 'string' || value.startsWith('--'))) {
      problems.push(`--${name} needs a value.`)
    }
    if (kind === 'boolean' && typeof value !== 'boolean') {
      problems.push(`--${name} takes no value.`)
    }
  }
  if (problems.length > 0) {
    throw new UsageError(problems.join('\n'))
  }
  return values
}

/** One validated string flag; the problem, if any, is added to `problems` under the flag's name. */
export function checked<T>(flag: string, schema: z.ZodType<T>, value: unknown, problems: string[]): T | undefined {
  if (value === undefined) {
    problems.push(`--${flag} is required.`)
    return undefined
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    problems.push(`--${flag}: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
    return undefined
  }
  return parsed.data
}

export function usageResult(message: string, usage: string): CliResult {
  return { code: 2, stdout: '', stderr: `${message}\n\nUsage:\n${usage}\n` }
}

export function refusal(message: string): CliResult {
  return { code: 1, stdout: '', stderr: `${message}\n` }
}

/** Standard input holds the password and a line break after it; only that one line break is not part of it. */
export function stripOneLineBreak(text: string): string {
  return text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
}

export interface ChosenPassword {
  readonly password: string
  /** True when the tool made it, so it is printed. */
  readonly generated: boolean
}

/** The password from standard input (`--password-stdin`), or a new strong one. Throws UsageError if the input is no password. */
export async function choosePassword(fromStdin: boolean, readStdin: () => Promise<string>): Promise<ChosenPassword> {
  if (!fromStdin) {
    return { password: generatePassword(), generated: true }
  }
  let text: string
  try {
    text = await readStdin()
  } catch (err) {
    if (err instanceof StdinTooLongError) {
      throw new UsageError('--password-stdin: standard input is too long for a password.')
    }
    throw err
  }
  const parsed = NewPassword.safeParse(stripOneLineBreak(text))
  if (!parsed.success) {
    throw new UsageError(
      `--password-stdin: ${parsed.error.issues[0]?.message ?? 'invalid'} (standard input is the password)`,
    )
  }
  return { password: parsed.data, generated: false }
}

/** As in the api: a password equal to the username or the e-mail address is refused. */
export function isTooObvious(
  password: string,
  account: { readonly username: string; readonly email: string },
): boolean {
  const lower = password.toLowerCase()
  return lower === account.username.toLowerCase() || lower === account.email.toLowerCase()
}

export const OBVIOUS_PASSWORD = 'The password must not be the username or the e-mail address.'

/** The deepest cause of an error: the driver's own, whose message holds no query text and no parameters. */
export function rootCause(err: unknown): unknown {
  let current: unknown = err
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null && 'cause' in current; depth += 1) {
    if (current.cause === undefined || current.cause === null) {
      break
    }
    current = current.cause
  }
  return current
}

/**
 * What the log gets of a failure. Not the error itself: Drizzle's message holds the failed query and its parameters, which for
 * these commands include the e-mail address and the password hash.
 */
export function failureFields(err: unknown): Record<string, unknown> {
  const root = rootCause(err)
  if (root instanceof Error) {
    const code = 'code' in root && typeof root.code === 'string' ? root.code : undefined
    return { error: root.name, ...(code === undefined ? {} : { code }), message: root.message }
  }
  return { error: 'unknown' }
}

export function loggerFor(options: CommandOptions, level: string): Logger {
  return options.logger ?? pino({ name: 'toa', level }, pino.destination(2))
}

/** Runs `work` with a one-connection database as the app role, and ends the connection. */
export function withDatabase<T>(
  options: CommandOptions,
  command: string,
  work: (db: Database, logger: Logger, config: AppDatabaseConfig) => Promise<T>,
): Promise<T | CliResult> {
  return withConfiguredDatabase(options, command, loadAppDatabaseConfig, work)
}

/**
 * As `withDatabase`, for a command that needs more of the environment than DATABASE_URL: `load` reads and validates it (and
 * throws a ConfigError, which is a refusal that names variables and never values) before any connection is made.
 */
export async function withConfiguredDatabase<C extends AppDatabaseConfig, T>(
  options: CommandOptions,
  command: string,
  load: (env: EnvSource | undefined) => C,
  work: (db: Database, logger: Logger, config: C) => Promise<T>,
): Promise<T | CliResult> {
  let config: C
  try {
    config = load(options.env)
  } catch (err) {
    if (err instanceof ConfigError) {
      return refusal(err.message)
    }
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  const { db, pool } = createDb({
    connectionString: config.DATABASE_URL,
    max: 1,
    applicationName: 'toascribe-cli',
  })
  pool.on('error', (err) => {
    logger.error(failureFields(err), 'database connection error')
  })
  try {
    return await work(db, logger, config)
  } catch (err) {
    logger.fatal(failureFields(err), `${command} failed`)
    return refusal(`${command} failed; see the log above`)
  } finally {
    await pool.end()
  }
}

export function isCliResult(value: unknown): value is CliResult {
  return typeof value === 'object' && value !== null && 'code' in value && 'stderr' in value && 'stdout' in value
}
