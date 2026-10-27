// Lost password, the first password of a new account, and registration (K-003, K-004, K-005). All of them end in a one-time link
// (`account_token`, 24 hours, single use, bound to one purpose).
//
// None of the public ones may tell whether an address (or, for a lost password, a login) has an account (K-004): they answer
// the same status and body, take about the same time (padded to a minimum, see lib/timing.ts), and when an account does exist
// the difference is only a mail in its owner's inbox. The one exception, by Tor's decision (M0.4): registration says 409
// `username_taken` for a name that is taken, as WordPress does; a name is public anyway.
import { WEAK_PASSWORD_MESSAGE, generateToken, hashPassword, hashToken, isTooObvious } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import { CoreSettings, ONE_TIME_LINK_HOURS } from '@toascribe/shared'
import type { AccountTokenPurpose, AuthOptionsResponse } from '@toascribe/shared'
import type { Logger } from 'pino'

import { AppError } from '../lib/errors.ts'
import { uniqueViolation } from '../lib/db-errors.ts'
import { withMinimumDuration } from '../lib/timing.ts'
import {
  findAccountByLogin,
  findAccountsByUsernameOrEmail,
  findRoleBySlug,
  freeNicename,
  grantRole,
  insertAccount,
  listAdministrators,
  setPasswordAndActivate,
} from '../repositories/accounts.ts'
import type { AccountView } from '../repositories/accounts.ts'
import {
  findTokenForUpdate,
  insertAccountToken,
  invalidateUnusedTokens,
  markTokenUsed,
} from '../repositories/account-tokens.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import { findPublishedById, pagePaths } from '../repositories/public.ts'
import { readSettings } from '../repositories/settings.ts'
import { deleteAllSessions } from '../repositories/sessions.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed } from './support.ts'
import type { Auditor, RequestContext, SafeMail } from './support.ts'

const HOUR_MS = 60 * 60 * 1000

/** The link is unknown, expired, used, meant for something else, or its account is disabled. One answer for all (K-004). */
export class InvalidTokenError extends AppError {
  constructor() {
    super(400, 'invalid_token', 'The link is not valid any more. Ask for a new one.')
  }
}

/** Registration is switched off (the setting «Anyone can register»). 403, not 404: the route exists, the site's setting refuses, and the setting is public anyway (GET /auth/options). */
export class RegistrationClosedError extends AppError {
  constructor() {
    super(403, 'registration_closed', 'Registration is closed')
  }
}

/**
 * The username is taken. As WordPress does it, registration says so (409): the visitor has to choose another name, and a name is
 * not a secret (the author archive shows it). The address is another matter and is never revealed, see `register`.
 */
export class UsernameTakenError extends AppError {
  constructor() {
    super(409, 'username_taken', 'That username is taken. Choose another.')
  }
}

/** The new password is a choice the site refuses (the same as the username or the address). */
export class WeakPasswordError extends AppError {
  constructor() {
    super(400, 'weak_password', WEAK_PASSWORD_MESSAGE)
  }
}

const OptionsSettings = CoreSettings.pick({
  users_can_register: true,
  blogname: true,
  wp_page_for_privacy_policy: true,
})

const RegistrationSettings = CoreSettings.pick({
  users_can_register: true,
  default_role: true,
  notify_admin_new_user: true,
  notify_admin_password_change: true,
})

/** A role that may be given to anyone who fills in the form: not the administrator, and none that can manage the site or its users. */
const FORBIDDEN_DEFAULT_ROLE_CAPABILITIES = ['manage_options', 'promote_users', 'edit_users', 'create_users']

export function nicenameFor(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'user' : slug
}

export interface PublicFlows {
  /** «Lost your password?». Resolves whatever happens; throws only for a name or an address that has to wait (429). */
  requestPasswordReset: (login: string, ctx: RequestContext) => Promise<void>
  /** The link of the lost-password mail: choose a new password. */
  resetPassword: (token: string, password: string, ctx: RequestContext) => Promise<void>
  /** The link of a welcome or registration mail: choose the first password. */
  setPassword: (token: string, password: string, ctx: RequestContext) => Promise<void>
  /** What the login screens need before anyone is signed in (GET /auth/options). */
  options: () => Promise<AuthOptionsResponse>
  register: (input: { username: string; email: string }, ctx: RequestContext) => Promise<void>
}

export function createPublicFlows(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly logger: Logger
  readonly limiter: RateLimiter
  readonly audit: Auditor
  readonly mail: SafeMail
  readonly minimumResponseMs: number
  readonly onInvalidSetting?: (key: string) => void
}): PublicFlows {
  const { db, clock, logger, limiter, audit, mail, minimumResponseMs, onInvalidSetting } = options

  /** Issues a link: uses up the earlier ones of the purpose, stores the hash, returns the token for the mail. */
  async function issueLink(tx: Executor, accountId: string, purpose: AccountTokenPurpose): Promise<string> {
    const now = clock()
    await invalidateUnusedTokens(tx, accountId, now, [purpose])
    const token = generateToken()
    await insertAccountToken(tx, {
      accountId,
      purpose,
      tokenHash: hashToken(token),
      newEmail: null,
      expiresAt: new Date(now.getTime() + ONE_TIME_LINK_HOURS * HOUR_MS),
      now,
    })
    return token
  }

  async function notifyAdministrators(
    exceptAccountId: string | null,
    build: (to: string) => Parameters<SafeMail>[0],
  ): Promise<void> {
    let recipients: Awaited<ReturnType<typeof listAdministrators>>
    try {
      recipients = await listAdministrators(db)
    } catch (err) {
      logger.error({ errorName: err instanceof Error ? err.name : 'unknown' }, 'could not list the administrators')
      return
    }
    for (const admin of recipients) {
      if (admin.id !== exceptAccountId) {
        await mail(build(admin.email))
      }
    }
  }

  async function chooseWith(
    purpose: Extract<AccountTokenPurpose, 'password_reset' | 'set_password'>,
    token: string,
    password: string,
    ctx: RequestContext,
  ): Promise<void> {
    // Every try counts against the address, like a lost-password request: a token cannot be guessed, but nobody should be
    // able to make the database look up hashes without limit.
    const ticket = await limiter.begin('password_lost', { ip: ctx.ip })
    assertNotDelayed(ticket.status, clock())

    const done = await inTransaction(db, async (tx) => {
      const now = clock()
      const found = await findTokenForUpdate(tx, hashToken(token))
      if (
        found?.purpose !== purpose ||
        found.usedAt !== null ||
        found.expiresAt.getTime() <= now.getTime() ||
        found.accountStatus === 'disabled'
      ) {
        throw new InvalidTokenError()
      }
      if (isTooObvious(password, { username: found.accountUsername, email: found.accountEmail })) {
        throw new WeakPasswordError()
      }
      const passwordHash = await hashPassword(password)
      if (!(await markTokenUsed(tx, found.id, now))) {
        throw new InvalidTokenError()
      }
      await setPasswordAndActivate(tx, found.accountId, passwordHash, now)
      // The owner has the account back: the failures that were counted against the login name end here (a succeeded row for
      // each action that is about the password; the table is append-only).
      await limiter.clear(found.accountId, ctx.ip, ['login', 'password_lost'], tx)
      // Any other link of the account (an e-mail change asked for with the old password, an older reset) is void now, and
      // so is every session: a reset may be the answer to a stolen password.
      await invalidateUnusedTokens(tx, found.accountId, now)
      const revoked = await deleteAllSessions(tx, found.accountId)
      await audit(tx, ctx, {
        actor: { id: found.accountId, username: found.accountUsername },
        action: purpose === 'password_reset' ? 'password.reset' : 'password.set',
        objectType: 'account',
        objectId: found.accountId,
        newValue: { sessionsRevoked: revoked },
      })
      return { accountId: found.accountId, username: found.accountUsername, email: found.accountEmail }
    })

    if (purpose === 'password_reset') {
      // The owner is told that the password was reset with a link (the change is made; this is the notice for it).
      await mail({
        template: 'security_notice',
        to: done.email,
        data: { username: done.username, action: 'password_reset' },
      })
      const settings = await readSettings(db, RegistrationSettings, onInvalidSetting)
      if (settings.notify_admin_password_change) {
        await notifyAdministrators(done.accountId, (to) => ({
          template: 'admin_password_change',
          to,
          data: { username: done.username },
        }))
      }
    }
  }

  async function createRegistration(
    input: { username: string; email: string },
    role: { id: string },
  ): Promise<{ accountId: string; token: string } | 'username_taken' | 'email_taken'> {
    try {
      return await inTransaction(db, async (tx) => {
        const now = clock()
        const accountId = await insertAccount(tx, {
          username: input.username,
          email: input.email,
          nicename: await freeNicename(tx, nicenameFor(input.username)),
          status: 'pending',
          now,
        })
        await grantRole(tx, accountId, role.id, now)
        const token = await issueLink(tx, accountId, 'set_password')
        return { accountId, token }
      })
    } catch (err) {
      // Two registrations for the same name (or address) at once: the second finds it taken.
      const constraint = uniqueViolation(err)
      if (constraint !== undefined) {
        return constraint === 'uq_account_email' ? 'email_taken' : 'username_taken'
      }
      throw err
    }
  }

  return {
    requestPasswordReset(login, ctx) {
      return withMinimumDuration(minimumResponseMs, async () => {
        const account = await findAccountByLogin(db, login)
        const ticket = await limiter.begin('password_lost', { ip: ctx.ip, accountId: account?.id ?? null, login })
        // A wait is told. The answer does not depend on whether the account exists: a name that matches none waits the same.
        assertNotDelayed(ticket.status, clock())
        if (account === undefined || account.status === 'disabled') {
          // The same 202 as for an account that exists.
          return
        }
        // An account that never chose a password gets its welcome link again, not a reset link.
        const purpose: AccountTokenPurpose = account.status === 'pending' ? 'set_password' : 'password_reset'
        const token = await inTransaction(db, async (tx) => {
          const issued = await issueLink(tx, account.id, purpose)
          await audit(tx, ctx, {
            actor: null,
            accountId: account.id,
            action: 'password.reset_requested',
            objectType: 'account',
            objectId: account.id,
          })
          return issued
        })
        await mail({ template: purpose, to: account.email, data: { username: account.username, token } })
      })
    },

    resetPassword(token, password, ctx) {
      return chooseWith('password_reset', token, password, ctx)
    },

    setPassword(token, password, ctx) {
      return chooseWith('set_password', token, password, ctx)
    },

    async options() {
      const settings = await readSettings(db, OptionsSettings, onInvalidSetting)
      const privacyId = settings.wp_page_for_privacy_policy
      const privacyPage = privacyId === null ? undefined : await findPublishedById(db, privacyId)
      return {
        registrationOpen: settings.users_can_register,
        siteName: settings.blogname.trim(),
        privacyPolicyPath:
          privacyPage === undefined
            ? null
            : ((await pagePaths(db, [privacyPage.id])).get(privacyPage.id)?.path ?? null),
      }
    },

    register(input, ctx) {
      return withMinimumDuration(minimumResponseMs, async () => {
        const settings = await readSettings(db, RegistrationSettings, onInvalidSetting)
        if (!settings.users_can_register) {
          throw new RegistrationClosedError()
        }
        const matches = await findAccountsByUsernameOrEmail(db, input.username, input.email)
        const byEmail: AccountView | undefined = matches.find(
          (account) => account.email.toLowerCase() === input.email.toLowerCase(),
        )
        const ticket = await limiter.begin('register', {
          ip: ctx.ip,
          accountId: byEmail?.id ?? null,
          login: input.email,
        })
        assertNotDelayed(ticket.status, clock())

        // The owner of the address, if there is one, is told about the attempt by mail, whatever the visitor is answered (Tor,
        // M0.4): the visitor learns nothing from it. A disabled account is left alone; one that is still waiting for its first
        // password gets the welcome link again.
        if (byEmail !== undefined && byEmail.status !== 'disabled') {
          if (byEmail.status === 'pending') {
            const token = await inTransaction(db, (tx) => issueLink(tx, byEmail.id, 'set_password'))
            await mail({ template: 'set_password', to: byEmail.email, data: { username: byEmail.username, token } })
          } else {
            await mail({ template: 'account_exists', to: byEmail.email, data: { username: byEmail.username } })
          }
        }

        // The username comes before the address: a taken name is answered 409 whether or not the address is taken too. Were the
        // address looked at first, «taken address» (202) and «free address» (409) with a name known to be taken would tell
        // anyone which addresses have an account.
        if (matches.some((account) => account.username.toLowerCase() === input.username.toLowerCase())) {
          throw new UsernameTakenError()
        }
        if (byEmail !== undefined) {
          // Same 202 as for a new account (K-004).
          return
        }

        const role = await findRoleBySlug(db, settings.default_role)
        if (
          role === undefined ||
          role.slug === 'administrator' ||
          role.capabilities.some((capability) => FORBIDDEN_DEFAULT_ROLE_CAPABILITIES.includes(capability))
        ) {
          // The settings schema refuses `administrator` already; this stops a custom role that is as good as one, and a role
          // that has been deleted. It is a site misconfiguration, not something the visitor did.
          logger.error(
            { role: settings.default_role },
            'registration is on but the default role cannot be given to visitors',
          )
          throw new AppError(503, 'registration_unavailable', 'Registration is not available right now')
        }

        const created = await createRegistration(input, role)
        if (created === 'email_taken') {
          // Two registrations for the same address at once: answered as a taken address always is.
          return
        }
        if (created === 'username_taken') {
          throw new UsernameTakenError()
        }
        await audit(db, ctx, {
          actor: { id: created.accountId, username: input.username },
          action: 'account.registered',
          objectType: 'account',
          objectId: created.accountId,
          newValue: { role: role.slug },
        })
        await mail({
          template: 'set_password',
          to: input.email,
          data: { username: input.username, token: created.token },
        })
        if (settings.notify_admin_new_user) {
          await notifyAdministrators(null, (to) => ({
            template: 'admin_new_user',
            to,
            data: { username: input.username, email: input.email },
          }))
        }
      })
    },
  }
}
