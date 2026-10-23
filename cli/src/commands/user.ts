// `toa user create`, `toa user reset-password`, `toa user reset-login-limit` and `toa user mfa-reset`: the operator's way to make an
// account, give one a new password, end the wait after failed logins or remove the second factors. They run in the api container as
// the app role (DATABASE_URL), in production too: unlike `dev seed tom` nothing here is destructive. The result goes to stdout (a
// generated password, once), the sentences to stderr and the log to stderr, so `toa user create … | …` carries nothing else than
// the password.
//
// `--notify` tells the owner of the account by e-mail (queued for the worker, after the change has committed): `create` mails a
// one-time link to choose the password, `reset-password` and `reset-login-limit` a security notice, and `mfa-reset` always sends its
// notice. A mail that cannot be queued does not undo the change; the command says so and exits 1.
import { generateToken, hashPassword, hashToken, isTooObvious } from '@toascribe/auth'
import { createMailProducer } from '@toascribe/db'
import { ONE_TIME_LINK_HOURS, RegisterRequest } from '@toascribe/shared'
import type { EmailMessage, KeyRing } from '@toascribe/shared'
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
  insertSetPasswordLink,
  listRoleSlugs,
  lockAccount,
  nicenameFor,
  rolesRequiringMfa,
  setPasswordHash,
  uniqueViolation,
  voidUnusedLinks,
} from '../accounts.ts'
import type { AccountSelector } from '../accounts.ts'
import { ConfigError, keyRingOf, loadKeyedDatabaseConfig } from '../config.ts'
import type { AppDatabaseConfig } from '../config.ts'
import {
  OBVIOUS_PASSWORD,
  UsageError,
  checked,
  choosePassword,
  failureFields,
  invalidInput,
  isCliResult,
  parseFlags,
  refusal,
  usageResult,
  withDatabase,
} from '../kit.ts'
import type { ChosenPassword } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import type { CliResult } from '../result.ts'
import { readProcessStdin } from '../stdin.ts'
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

/**
 * Queues `message` for the worker: through the producer the caller passed, or one on DATABASE_URL that is stopped when done.
 * Returns false, after logging why, when it could not be queued; the change it reports has been made all the same.
 */
async function queueMail(
  options: CommandOptions,
  config: AppDatabaseConfig,
  logger: Logger,
  message: EmailMessage,
  what: string,
  keyRing?: KeyRing,
): Promise<boolean> {
  const producer =
    options.mail ??
    createMailProducer({
      connectionString: config.DATABASE_URL,
      applicationName: 'toascribe-cli',
      logger,
      ...(keyRing === undefined ? {} : { keyRing }),
    })
  try {
    await producer.sendMail(message)
    return true
  } catch (err) {
    logger.error(failureFields(err), `could not queue the ${what}`)
    return false
  } finally {
    if (options.mail === undefined) {
      await producer.stop().catch(() => undefined)
    }
  }
}

/** The key ring of the encryption key in the environment, for a command that queues a mail with a one-time link; undefined when the caller brings its own producer. */
async function keyRingFor(options: CommandOptions): Promise<KeyRing | undefined | CliResult> {
  if (options.mail !== undefined) {
    return undefined
  }
  try {
    return await keyRingOf(loadKeyedDatabaseConfig(options.env))
  } catch (err) {
    if (err instanceof ConfigError) {
      return invalidInput(err.message)
    }
    throw err
  }
}

/** The text after a change whose notice could not be queued: the change stands, running the command again would repeat it. */
function notQueued(done: string): CliResult {
  return { code: 1, stdout: '', stderr: `${done}, but the e-mail could not be queued (see the log above).\n` }
}

const HOUR_MS = 60 * 60 * 1000

const CREATE_FLAGS = {
  username: 'string',
  email: 'string',
  role: 'string',
  'display-name': 'string',
  'password-stdin': 'boolean',
  notify: 'boolean',
} as const

/** The outcome of the transaction of `user create`, other than success. */
interface CreateRefusal {
  readonly refused: readonly string[]
}

export async function userCreate(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let input: { username: string; email: string; role: string; displayName: string | undefined }
  let chosen: ChosenPassword | undefined
  let notify = false
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
    notify = flags['notify'] === true
    if (notify && flags['password-stdin'] === true) {
      problems.push(
        '--notify and --password-stdin exclude each other: with --notify the person chooses the password with the link in the mail.',
      )
    }
    if (problems.length > 0 || username === undefined || email === undefined || role === undefined) {
      throw new UsageError(problems.join('\n'))
    }
    input = { username, email, role, displayName }
    // With --notify there is no password to choose here: the account waits for its owner to follow the link.
    if (!notify) {
      chosen = await choosePassword(flags['password-stdin'] === true, options.readStdin ?? readProcessStdin)
      if (isTooObvious(chosen.password, input)) {
        throw new UsageError(OBVIOUS_PASSWORD)
      }
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_CREATE_USAGE)
    }
    throw err
  }

  // The token of the link is sealed with the encryption key before the job is stored: checked now, before anything is made.
  const keyRing = notify ? await keyRingFor(options) : undefined
  if (isCliResult(keyRing)) {
    return keyRing
  }
  const passwordHash = chosen === undefined ? null : await hashPassword(chosen.password)
  const token = notify ? generateToken() : undefined
  const outcome = await withDatabase(options, 'user create', async (db, logger, config) => {
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
          status: passwordHash === null ? 'pending' : 'active',
          roleId: role.id,
          now,
        })
        if (token !== undefined) {
          await insertSetPasswordLink(tx, {
            accountId: id,
            tokenHash: hashToken(token),
            expiresAt: new Date(now.getTime() + ONE_TIME_LINK_HOURS * HOUR_MS),
            now,
          })
        }
        await insertCliAudit(
          tx,
          {
            accountId: id,
            action: 'account.created',
            newValue: { role: role.slug, ...(notify ? { welcomeMail: true } : {}) },
          },
          now,
        )
        return { id }
      })
      if ('refused' in created) {
        return refusal(created.refused.join('\n'))
      }
      logger.info({ accountId: created.id, role: input.role }, 'account created')
      if (token !== undefined) {
        const queued = await queueMail(
          options,
          config,
          logger,
          { template: 'set_password', to: input.email, data: { username: input.username, token } },
          'welcome mail',
          keyRing,
        )
        if (!queued) {
          return {
            code: 1,
            stdout: '',
            stderr:
              `Created the account "${input.username}" with the role ${input.role}, waiting for its first password, ` +
              'but the welcome mail could not be queued (see the log above). The person can ask for a new link with «Lost your password?» ' +
              'on the login page.\n',
          }
        }
      }
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
    stdout: chosen?.generated === true ? `${chosen.password}\n` : '',
    stderr:
      `Created the account "${input.username}" with the role ${input.role}.\n` +
      (notify
        ? `It has no password yet: a mail with a link to choose one (valid ${String(ONE_TIME_LINK_HOURS)} hours) is queued to the address of the account.\n`
        : chosen?.generated === true
          ? 'Its password is printed once, below, and kept nowhere else.\n'
          : ''),
  }
}

const RESET_FLAGS = { username: 'string', email: 'string', 'password-stdin': 'boolean', notify: 'boolean' } as const

interface ResetRefusal {
  readonly refused: string
  /** The input is wrong by itself (a password the rules refuse): exit 2 with the usage. Otherwise the database decided: exit 1. */
  readonly invalid?: true
}

export async function userResetPassword(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let selector: AccountSelector
  let chosen: ChosenPassword
  let notify = false
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
    notify = flags['notify'] === true
    chosen = await choosePassword(flags['password-stdin'] === true, options.readStdin ?? readProcessStdin)
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_RESET_PASSWORD_USAGE)
    }
    throw err
  }

  const passwordHash = await hashPassword(chosen.password)
  const outcome = await withDatabase(options, 'user reset-password', async (db, logger, config) => {
    const done = await db.transaction(
      async (
        tx,
      ): Promise<{ id: string; username: string; email: string; status: string; sessions: number } | ResetRefusal> => {
        const found = await lockAccount(tx, selector)
        if (found === undefined) {
          return {
            refused: `--${'username' in selector ? 'username' : 'email'}: no account has that ${'username' in selector ? 'username' : 'e-mail address'}.`,
          }
        }
        if (isTooObvious(chosen.password, found)) {
          return { refused: OBVIOUS_PASSWORD, invalid: true }
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
        return { id: found.id, username: found.username, email: found.email, status: found.status, sessions }
      },
    )
    if ('refused' in done) {
      return done.invalid === true ? usageResult(done.refused, USER_RESET_PASSWORD_USAGE) : refusal(done.refused)
    }
    logger.info({ accountId: done.id, sessionsEnded: done.sessions }, 'password reset')
    if (notify) {
      const queued = await queueMail(
        options,
        config,
        logger,
        {
          template: 'security_notice',
          to: done.email,
          data: { username: done.username, action: 'password_reset_by_admin' },
        },
        'security notice',
      )
      if (!queued) {
        // The new password is the result of the command and exists nowhere else: it is printed all the same.
        return {
          code: 1,
          stdout: chosen.generated ? `${chosen.password}\n` : '',
          stderr:
            `Set a new password for "${done.username}" and ended ${String(done.sessions)} session(s)` +
            (chosen.generated ? ' (the password is printed once, below)' : '') +
            ', but the security notice could not be queued (see the log above).\n',
        }
      }
    }
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
      (notify ? 'A security notice is queued to the e-mail address of the account.\n' : '') +
      (chosen.generated ? 'The password is printed once, below, and kept nowhere else.\n' : ''),
  }
}

const RESET_LIMIT_FLAGS = { username: 'string', email: 'string', notify: 'boolean' } as const

/**
 * `toa user reset-login-limit`: ends the wait the api puts on an account after failed logins (and failed codes, lost-password
 * requests and registrations that named it). The administrator's way out for an account someone is guessing at: the wait is a
 * delay, never a lock, but an owner who is made to wait does not have to. Writes an audit entry. The wait of an IP address is
 * not touched: it ends by itself within the window.
 */
export async function userResetLoginLimit(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  let selector: AccountSelector
  let notify = false
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
    notify = flags['notify'] === true
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, USER_RESET_LOGIN_LIMIT_USAGE)
    }
    throw err
  }

  const outcome = await withDatabase(options, 'user reset-login-limit', async (db, logger, config) => {
    const done = await db.transaction(
      async (tx): Promise<{ id: string; username: string; email: string } | ResetRefusal> => {
        const found = await lockAccount(tx, selector)
        if (found === undefined) {
          return {
            refused: `--${'username' in selector ? 'username' : 'email'}: no account has that ${'username' in selector ? 'username' : 'e-mail address'}.`,
          }
        }
        const now = new Date()
        await clearLoginAttempts(tx, found.id, ['login', 'mfa', 'password_lost', 'register'], now)
        await insertCliAudit(tx, { accountId: found.id, action: 'login_limit.reset' }, now)
        return { id: found.id, username: found.username, email: found.email }
      },
    )
    if ('refused' in done) {
      return refusal(done.refused)
    }
    logger.info({ accountId: done.id }, 'login limit reset')
    if (notify) {
      const queued = await queueMail(
        options,
        config,
        logger,
        { template: 'security_notice', to: done.email, data: { username: done.username, action: 'login_limit_reset' } },
        'security notice',
      )
      if (!queued) {
        return notQueued(`Ended the wait after failed attempts for "${done.username}"`)
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
      `Ended the wait after failed attempts for "${outcome.username}". Sessions and the password are unchanged.\n` +
      (notify ? 'A notice is queued to the e-mail address of the account.\n' : ''),
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
    const queued = await queueMail(
      options,
      config,
      logger,
      { template: 'security_notice', to: done.email, data: { username: done.username, action: 'mfa_reset' } },
      'security notice',
    )
    if (!queued) {
      return {
        code: 1,
        stdout: '',
        stderr:
          `The second factors of "${done.username}" are removed and its ${String(done.sessions)} session(s) ended, ` +
          'but the security notice could not be queued (see the log above). Run the command again to queue it.\n',
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
