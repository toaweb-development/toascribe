// Lost password, the first password of a new account, and registration (K-003, K-004, K-005). All of them end in a one-time link
// (`account_token`, 24 hours, single use, bound to one purpose).
//
// None of the public ones may tell whether an address (or, for a lost password, a login) has an account (K-004): they answer
// the same status and body, take about the same time (padded to a minimum, see lib/timing.ts), and when an account does exist
// the difference is only a mail in its owner's inbox. The one exception, by Tor's decision (M0.4): registration says 409
// `username_taken` for a name that is taken, as WordPress does; a name is public anyway.
import { createHmac } from 'node:crypto'

import {
  WEAK_PASSWORD_MESSAGE,
  constantTimeEqual,
  generateToken,
  hashPassword,
  hashToken,
  isTooObvious,
} from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import { CoreSettings, ONE_TIME_LINK_HOURS, isRegistrationRole } from '@toascribe/shared'
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

/** How old the registration form's token must be (K-006): a person reads the form and types; a bot sends at once. */
export const REGISTER_FORM_MIN_MS = 2_000
/** And at most this old: a form left open longer is drawn again. */
export const REGISTER_FORM_MAX_MS = 60 * 60 * 1000

/** The registration form failed the spam checks (K-006). The message says what a person can do, not what was checked. */
export class FormRejectedError extends AppError {
  constructor() {
    super(400, 'form_rejected', 'The form could not be sent. Load the page again, wait a moment and try again.')
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
  show_on_front: true,
  page_on_front: true,
  locale: true,
})

const RegistrationSettings = CoreSettings.pick({
  users_can_register: true,
  default_role: true,
  notify_admin_new_user: true,
  notify_admin_password_change: true,
})

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
  /** What the login screens need before anyone is signed in (GET /auth/options). The form token is bound to `client.ip`. */
  options: (client: { readonly ip: string }) => Promise<AuthOptionsResponse>
  register: (
    input: { username: string; email: string; formToken: string; website?: string | undefined },
    ctx: RequestContext,
  ) => Promise<void>
}

/** Issues a one-time link: uses up the earlier ones of the purpose, stores the hash, returns the token for the mail. */
export async function issueAccountLink(
  tx: Executor,
  accountId: string,
  purpose: AccountTokenPurpose,
  now: Date,
): Promise<string> {
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

export function createPublicFlows(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly logger: Logger
  readonly limiter: RateLimiter
  readonly audit: Auditor
  readonly mail: SafeMail
  readonly minimumResponseMs: number
  readonly onInvalidSetting?: (key: string) => void
  /** Signs the registration form's token (TOASCRIBE_SIGNING_KEY). */
  readonly signingKey: Uint8Array
  /** How old the form token must be before the form is taken (K-006). Default 2 s; tests set 0. */
  readonly registerFormMinMs?: number
}): PublicFlows {
  const { db, clock, logger, limiter, audit, mail, minimumResponseMs, onInvalidSetting } = options
  const registerFormMinMs = options.registerFormMinMs ?? REGISTER_FORM_MIN_MS

  /**
   * `<issued ms>.<HMAC>`: when the form was drawn and for which client address, signed so it cannot be made up. Bound to the
   * address, so one fetched token does not open registration for every address a bot has.
   */
  function formToken(at: number, ip: string): string {
    return `${String(at)}.${createHmac('sha256', options.signingKey)
      .update(`register-form:${String(at)}:${ip}`)
      .digest('base64url')}`
  }

  /** The spam checks of K-006: the hidden field is empty, and the token is ours, for this address, old enough and not too old. */
  function assertHuman(input: { formToken: string; website?: string | undefined }, ip: string): void {
    const issued = Number(input.formToken.split('.')[0])
    const now = clock().getTime()
    const ok =
      (input.website ?? '') === '' &&
      Number.isSafeInteger(issued) &&
      constantTimeEqual(formToken(issued, ip), input.formToken) &&
      now - issued >= registerFormMinMs &&
      now - issued <= REGISTER_FORM_MAX_MS
    if (!ok) throw new FormRejectedError()
  }

  const issueLink = (tx: Executor, accountId: string, purpose: AccountTokenPurpose) =>
    issueAccountLink(tx, accountId, purpose, clock())

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

    async options(client) {
      const settings = await readSettings(db, OptionsSettings, onInvalidSetting)
      const privacyId = settings.wp_page_for_privacy_policy
      const privacyPage = privacyId === null ? undefined : await findPublishedById(db, privacyId)
      return {
        registrationOpen: settings.users_can_register,
        siteName: settings.blogname.trim(),
        formToken: formToken(clock().getTime(), client.ip),
        locale: settings.locale,
        // The same address the site gives it: `/` when it is the static front page.
        privacyPolicyPath:
          privacyPage === undefined
            ? null
            : settings.show_on_front === 'page' && settings.page_on_front === privacyPage.id
              ? '/'
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
        // After the limit is counted: a bot that keeps sending is slowed down as anyone else.
        assertHuman(input, ctx.ip)

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
        if (role === undefined || !isRegistrationRole(role)) {
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
