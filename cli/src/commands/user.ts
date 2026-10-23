// `toa user create`, `toa user reset-password`, `toa user reset-login-limit` and `toa user mfa-reset`: the operator's way to make an account, give
// one a new password or end the wait after failed logins, before the setup wizard (M0.4) and without the e-mail round trip. They run in the api container as the app role (DATABASE_URL), in
// production too: unlike `dev seed tom` nothing here is destructive. The result goes to stdout (a generated password, once),
// the sentences to stderr and the log to stderr, so `toa user create … | …` carries nothing else than the password.
import { parseArgs } from 'node:util'

import { hashPassword } from '@toascribe/auth'
import { createDb, createMailProducer } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { NewPassword, RegisterRequest, generatePassword } from '@toascribe/shared'
import { pino } from 'pino'
import type { Logger } from 'pino'
import { z } from 'zod'

import {
  clearLoginAttempts,
  deleteMfaCredentials,
  deleteRecoveryCodes,
  deleteSessions,
  findRole,
  findTaken,
  freeNicename,
  insertAccountWithRole,
  insertCliAudit,
  listRoleSlugs,
  lockAccount,
  nicenameFor,
  rolesRequiringMfa,
  setPasswordHash,
  uniqueViolation,
  voidUnusedLinks,
} from '../accounts.ts'
import type { AccountSelector } from '../accounts.ts'
import { ConfigError, loadAppDatabaseConfig } from '../config.ts'
import type { AppDatabaseConfig } from '../config.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { readProcessStdin, StdinTooLongError } from '../stdin.ts'
import {
  USER_CREATE_USAGE,
  USER_MFA_RESET_USAGE,
  USER_RESET_LOGIN_LIMIT_USAGE,
  USER_RESET_PASSWORD_USAGE,
} from '../usage.ts'

const CONTROL_CHARACTER = /\p{Cc}/u

// The same rules as registration and the password screens (packages/shared), so an account made here is one the api accepts.
const Username = RegisterRequest.shape.username
const Email = RegisterRequest.shape.email
const RoleSlug = z.string().min(1).max(100)
const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(250)
  .refine((value) => !CONTROL_CHARACTER.test(value), { message: 'Must be one line, without control characters' })

type FlagKind = 'string' | 'boolean'

type FlagValues = Readonly<Record<string, string | boolean | undefined>>

/** A usage problem: a bad flag or value (exit code 2). The message names flags and rules, never values. */
class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/**
 * Reads `--flag value` pairs. Unknown options are reported by name only, and a stray argument is not echoed: people try
 * `--password hunter2`, and the value must not come back in a message.
 */
function parseFlags(args: readonly string[], spec: Readonly<Record<string, FlagKind>>): FlagValues {
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
function checked<T>(flag: string, schema: z.ZodType<T>, value: unknown, problems: string[]): T | undefined {
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

function usageResult(message: string, usage: string): CliResult {
  return { code: 2, stdout: '', stderr: `${message}\n\nUsage:\n${usage}\n` }
}

function refusal(message: string): CliResult {
  return { code: 1, stdout: '', stderr: `${message}\n` }
}

/** Standard input holds the password and a line break after it; only that one line break is not part of it. */
function stripOneLineBreak(text: string): string {
  return text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
}

interface ChosenPassword {
  readonly password: string
  /** True when the tool made it, so it is printed. */
  readonly generated: boolean
}

/** The password from standard input (`--password-stdin`), or a new strong one. Throws UsageError if the input is no password. */
async function choosePassword(fromStdin: boolean, readStdin: () => Promise<string>): Promise<ChosenPassword> {
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
function isTooObvious(password: string, account: { readonly username: string; readonly email: string }): boolean {
  const lower = password.toLowerCase()
  return lower === account.username.toLowerCase() || lower === account.email.toLowerCase()
}

const OBVIOUS_PASSWORD = 'The password must not be the username or the e-mail address.'

/** The deepest cause of an error: the driver's own, whose message holds no query text and no parameters. */
function rootCause(err: unknown): unknown {
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
function failureFields(err: unknown): Record<string, unknown> {
  const root = rootCause(err)
  if (root instanceof Error) {
    const code = 'code' in root && typeof root.code === 'string' ? root.code : undefined
    return { error: root.name, ...(code === undefined ? {} : { code }), message: root.message }
  }
  return { error: 'unknown' }
}

function loggerFor(options: CommandOptions, level: string): Logger {
  return options.logger ?? pino({ name: 'toa', level }, pino.destination(2))
}

/** Runs `work` with a one-connection database as the app role, and ends the connection. */
async function withDatabase<T>(
  options: CommandOptions,
  command: string,
  work: (db: Database, logger: Logger, config: AppDatabaseConfig) => Promise<T>,
): Promise<T | CliResult> {
  let config
  try {
    config = loadAppDatabaseConfig(options.env)
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

function isCliResult(value: unknown): value is CliResult {
  return typeof value === 'object' && value !== null && 'code' in value && 'stderr' in value && 'stdout' in value
}

const CREATE_FLAGS = {
  username: 'string',
  email: 'string',
  role: 'string',
  'display-name': 'string',
  'password-stdin': 'boolean',
} as const

/** The outcome of the transaction of `user create`, other than success. */
interface CreateRefusal {
  readonly refused: readonly string[]
}

export async function userCreate(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let input: { username: string; email: string; role: string; displayName: string | undefined }
  let chosen: ChosenPassword
  try {
    const flags = parseFlags(args, CREATE_FLAGS)
    const problems: string[] = []
    const username = checked('username', Username, flags['username'], problems)
    const email = checked('email', Email, flags['email'], problems)
    const role = checked('role', RoleSlug, flags['role'], problems)
    const displayName =
      flags['display-name'] === undefined
        ? undefined
        : checked('display-name', DisplayName, flags['display-name'], problems)
    if (problems.length > 0 || username === undefined || email === undefined || role === undefined) {
      throw new UsageError(problems.join('\n'))
    }
    input = { username, email, role, displayName }
    chosen = await choosePassword(flags['password-stdin'] === true, options.readStdin ?? readProcessStdin)
    if (isTooObvious(chosen.password, input)) {
      throw new UsageError(OBVIOUS_PASSWORD)
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_CREATE_USAGE)
    }
    throw err
  }

  const passwordHash = await hashPassword(chosen.password)
  const outcome = await withDatabase(options, 'user create', async (db, logger) => {
    try {
      const created = await db.transaction(async (tx): Promise<{ id: string } | CreateRefusal> => {
        const role = await findRole(tx, input.role)
        if (role === undefined) {
          const slugs = await listRoleSlugs(tx)
          return { refused: [`--role: there is no role with that slug. The roles are: ${slugs.join(', ')}.`] }
        }
        const taken = await findTaken(tx, input.username, input.email)
        if (taken.username || taken.email) {
          return {
            refused: [
              ...(taken.username ? ['--username: an account already has that username (case is ignored).'] : []),
              ...(taken.email ? ['--email: an account already has that e-mail address (case is ignored).'] : []),
            ],
          }
        }
        const now = new Date()
        const id = await insertAccountWithRole(tx, {
          username: input.username,
          email: input.email,
          displayName: input.displayName ?? input.username,
          nicename: await freeNicename(tx, nicenameFor(input.username)),
          passwordHash,
          roleId: role.id,
          now,
        })
        await insertCliAudit(tx, { accountId: id, action: 'account.created', newValue: { role: role.slug } }, now)
        return { id }
      })
      if ('refused' in created) {
        return refusal(created.refused.join('\n'))
      }
      logger.info({ accountId: created.id, role: input.role }, 'account created')
      return created
    } catch (err) {
      // Two creations of one name at once: the second finds it taken.
      const constraint = uniqueViolation(err)
      if (constraint !== undefined) {
        return refusal(
          constraint.includes('email')
            ? '--email: an account already has that e-mail address (case is ignored).'
            : constraint.includes('username')
              ? '--username: an account already has that username (case is ignored).'
              : 'An account with that name already exists.',
        )
      }
      throw err
    }
  })
  if (isCliResult(outcome)) {
    return outcome
  }
  return {
    code: 0,
    stdout: chosen.generated ? `${chosen.password}\n` : '',
    stderr:
      `Created the account "${input.username}" with the role ${input.role}.\n` +
      (chosen.generated ? 'Its password is printed once, below, and kept nowhere else.\n' : ''),
  }
}

const RESET_FLAGS = { username: 'string', email: 'string', 'password-stdin': 'boolean' } as const

interface ResetRefusal {
  readonly refused: string
}

export async function userResetPassword(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let selector: AccountSelector
  let chosen: ChosenPassword
  try {
    const flags = parseFlags(args, RESET_FLAGS)
    const problems: string[] = []
    if ((flags['username'] === undefined) === (flags['email'] === undefined)) {
      problems.push('Give exactly one of --username and --email.')
    }
    const username =
      flags['username'] === undefined ? undefined : checked('username', Username, flags['username'], problems)
    const email = flags['email'] === undefined ? undefined : checked('email', Email, flags['email'], problems)
    if (problems.length > 0) {
      throw new UsageError(problems.join('\n'))
    }
    if (username !== undefined) {
      selector = { username }
    } else if (email !== undefined) {
      selector = { email }
    } else {
      throw new UsageError('Give exactly one of --username and --email.')
    }
    chosen = await choosePassword(flags['password-stdin'] === true, options.readStdin ?? readProcessStdin)
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_RESET_PASSWORD_USAGE)
    }
    throw err
  }

  const passwordHash = await hashPassword(chosen.password)
  const outcome = await withDatabase(options, 'user reset-password', async (db, logger) => {
    const done = await db.transaction(
      async (tx): Promise<{ id: string; username: string; status: string; sessions: number } | ResetRefusal> => {
        const found = await lockAccount(tx, selector)
        if (found === undefined) {
          return {
            refused: `--${'username' in selector ? 'username' : 'email'}: no account has that ${'username' in selector ? 'username' : 'e-mail address'}.`,
          }
        }
        if (isTooObvious(chosen.password, found)) {
          return { refused: OBVIOUS_PASSWORD }
        }
        const now = new Date()
        await setPasswordHash(tx, found.id, passwordHash, now)
        const sessions = await deleteSessions(tx, found.id)
        // A lost-password link sent before this is no longer a way in, as after a reset through the api.
        const links = await voidUnusedLinks(tx, found.id, now)
        // The owner is back in: the wait after failed logins ends too, as after a reset through the api.
        await clearLoginAttempts(tx, found.id, ['login', 'password_lost'], now)
        await insertCliAudit(
          tx,
          { accountId: found.id, action: 'password.reset', newValue: { sessionsEnded: sessions, linksVoided: links } },
          now,
        )
        return { id: found.id, username: found.username, status: found.status, sessions }
      },
    )
    if ('refused' in done) {
      return refusal(done.refused)
    }
    logger.info({ accountId: done.id, sessionsEnded: done.sessions }, 'password reset')
    return done
  })
  if (isCliResult(outcome)) {
    return outcome
  }
  return {
    code: 0,
    stdout: chosen.generated ? `${chosen.password}\n` : '',
    stderr:
      `Set a new password for "${outcome.username}" and ended ${String(outcome.sessions)} session(s).\n` +
      (outcome.status === 'active' ? '' : `The account is ${outcome.status}; that is unchanged.\n`) +
      (chosen.generated ? 'The password is printed once, below, and kept nowhere else.\n' : ''),
  }
}

const RESET_LIMIT_FLAGS = { username: 'string', email: 'string' } as const

/**
 * `toa user reset-login-limit`: ends the wait the api puts on an account after failed logins (and failed codes, lost-password
 * requests and registrations that named it). The administrator's way out for an account someone is guessing at: the wait is a
 * delay, never a lock, but an owner who is made to wait does not have to. Writes an audit entry. The wait of an IP address is
 * not touched: it ends by itself within the window.
 */
export async function userResetLoginLimit(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let selector: AccountSelector
  try {
    const flags = parseFlags(args, RESET_LIMIT_FLAGS)
    const problems: string[] = []
    if ((flags['username'] === undefined) === (flags['email'] === undefined)) {
      problems.push('Give exactly one of --username and --email.')
    }
    const username =
      flags['username'] === undefined ? undefined : checked('username', Username, flags['username'], problems)
    const email = flags['email'] === undefined ? undefined : checked('email', Email, flags['email'], problems)
    if (problems.length > 0) {
      throw new UsageError(problems.join('\n'))
    }
    if (username !== undefined) {
      selector = { username }
    } else if (email !== undefined) {
      selector = { email }
    } else {
      throw new UsageError('Give exactly one of --username and --email.')
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_RESET_LOGIN_LIMIT_USAGE)
    }
    throw err
  }

  const outcome = await withDatabase(options, 'user reset-login-limit', async (db, logger) => {
    const done = await db.transaction(async (tx): Promise<{ id: string; username: string } | ResetRefusal> => {
      const found = await lockAccount(tx, selector)
      if (found === undefined) {
        return {
          refused: `--${'username' in selector ? 'username' : 'email'}: no account has that ${'username' in selector ? 'username' : 'e-mail address'}.`,
        }
      }
      const now = new Date()
      await clearLoginAttempts(tx, found.id, ['login', 'mfa', 'password_lost', 'register'], now)
      await insertCliAudit(tx, { accountId: found.id, action: 'login_limit.reset' }, now)
      return { id: found.id, username: found.username }
    })
    if ('refused' in done) {
      return refusal(done.refused)
    }
    logger.info({ accountId: done.id }, 'login limit reset')
    return done
  })
  if (isCliResult(outcome)) {
    return outcome
  }
  return {
    code: 0,
    stdout: '',
    stderr: `Ended the wait after failed attempts for "${outcome.username}". Sessions and the password are unchanged.\n`,
  }
}

const MFA_RESET_FLAGS = { username: 'string', email: 'string', notify: 'boolean' } as const

/**
 * `toa user mfa-reset`: for an owner who has lost the authenticator app and the recovery codes. Removes every second factor
 * and recovery code of the account, ends all its sessions (so a stolen session cannot go on) and writes the audit entry, in
 * one transaction; then queues the `security_notice` mail to the account's own address. The notice is always sent (Tor):
 * `--notify` is accepted so the `toa user` commands take the same flags, and changes nothing.
 *
 * The mail is queued after the commit. If the queue is unreachable the reset stands (it is the security action), the command
 * says so and exits 1, and running it again queues the notice. Nothing secret is printed: there is no secret here.
 */
export async function userMfaReset(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let selector: AccountSelector
  try {
    const flags = parseFlags(args, MFA_RESET_FLAGS)
    const problems: string[] = []
    if ((flags['username'] === undefined) === (flags['email'] === undefined)) {
      problems.push('Give exactly one of --username and --email.')
    }
    const username =
      flags['username'] === undefined ? undefined : checked('username', Username, flags['username'], problems)
    const email = flags['email'] === undefined ? undefined : checked('email', Email, flags['email'], problems)
    if (problems.length > 0) {
      throw new UsageError(problems.join('\n'))
    }
    if (username !== undefined) {
      selector = { username }
    } else if (email !== undefined) {
      selector = { email }
    } else {
      throw new UsageError('Give exactly one of --username and --email.')
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_MFA_RESET_USAGE)
    }
    throw err
  }

  interface Done {
    readonly id: string
    readonly username: string
    readonly email: string
    readonly factors: number
    readonly recoveryCodes: number
    readonly sessions: number
    readonly requiredBy: readonly string[]
  }
  const outcome = await withDatabase(options, 'user mfa-reset', async (db, logger, config) => {
    const done = await db.transaction(async (tx): Promise<Done | ResetRefusal> => {
      const found = await lockAccount(tx, selector)
      if (found === undefined) {
        return {
          refused: `--${'username' in selector ? 'username' : 'email'}: no account has that ${'username' in selector ? 'username' : 'e-mail address'}.`,
        }
      }
      const now = new Date()
      const byType = await deleteMfaCredentials(tx, found.id)
      const recoveryCodes = await deleteRecoveryCodes(tx, found.id)
      const sessions = await deleteSessions(tx, found.id)
      const factors = Object.values(byType).reduce((sum, n) => sum + n, 0)
      await insertCliAudit(
        tx,
        {
          accountId: found.id,
          action: 'mfa.reset',
          newValue: { factorsRemoved: byType, recoveryCodesRemoved: recoveryCodes, sessionsEnded: sessions },
        },
        now,
      )
      return {
        id: found.id,
        username: found.username,
        email: found.email,
        factors,
        recoveryCodes,
        sessions,
        requiredBy: await rolesRequiringMfa(tx, found.id),
      }
    })
    if ('refused' in done) {
      return refusal(done.refused)
    }
    logger.info(
      {
        accountId: done.id,
        factorsRemoved: done.factors,
        recoveryCodesRemoved: done.recoveryCodes,
        sessionsEnded: done.sessions,
      },
      'second factors reset',
    )
    const producer =
      options.mail ??
      createMailProducer({ connectionString: config.DATABASE_URL, applicationName: 'toascribe-cli', logger })
    try {
      await producer.sendMail({
        template: 'security_notice',
        to: done.email,
        data: { username: done.username, action: 'mfa_reset' },
      })
    } catch (err) {
      logger.error(failureFields(err), 'could not queue the security notice')
      return {
        code: 1,
        stdout: '',
        stderr:
          `The second factors of "${done.username}" are removed and its ${String(done.sessions)} session(s) ended, ` +
          'but the security notice could not be queued (see the log above). Run the command again to queue it.\n',
      }
    } finally {
      if (options.mail === undefined) {
        await producer.stop().catch(() => undefined)
      }
    }
    return done
  })
  if (isCliResult(outcome)) {
    return outcome
  }
  return {
    code: 0,
    stdout: '',
    stderr:
      `Removed ${String(outcome.factors)} second factor(s) and ${String(outcome.recoveryCodes)} recovery code(s) from ` +
      `"${outcome.username}" and ended ${String(outcome.sessions)} session(s).\n` +
      'A security notice is queued to the e-mail address of the account.\n' +
      (outcome.requiredBy.length > 0
        ? `The role ${outcome.requiredBy.join(', ')} requires a second factor (mfa_required_roles), so the next login lands in enrolment: the owner signs in with the password and sets up a new factor.\n`
        : 'No role of the account requires a second factor, so the next login needs only the password.\n'),
  }
}
