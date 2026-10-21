// What the signed-in person does to their own account's credentials: change the password (K-013) and change the e-mail address
// (K-012). Both ask for the current password: a stolen session alone is not enough to take the account over.
import { generateToken, hashPassword, hashToken } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import { CoreSettings, ONE_TIME_LINK_HOURS } from '@toascribe/shared'
import type { Logger } from 'pino'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError } from '../lib/errors.ts'
import { uniqueViolation } from '../lib/db-errors.ts'
import { withMinimumDuration } from '../lib/timing.ts'
import { emailInUse, findAccountByEmail, listAdministrators, setEmail, setPassword } from '../repositories/accounts.ts'
import {
  findTokenForUpdate,
  insertAccountToken,
  invalidateUnusedTokens,
  markTokenUsed,
} from '../repositories/account-tokens.ts'
import { inTransaction } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'
import { deleteOtherSessions } from '../repositories/sessions.ts'
import { InvalidTokenError, WeakPasswordError, isTooObvious } from './account-links.ts'
import type { Reauthenticator } from './reauth.ts'
import { assertNotLocked } from './support.ts'
import type { Auditor, RequestContext, SafeMail } from './support.ts'
import type { RateLimiter } from './rate-limit.ts'

const HOUR_MS = 60 * 60 * 1000

const NoticeSettings = CoreSettings.pick({ notify_admin_password_change: true })

export interface OwnAccountService {
  changePassword: (auth: SessionAuth, current: string, next: string, ctx: RequestContext) => Promise<void>
  /** Asks for the change. Resolves the same whether or not the address is free. */
  requestEmailChange: (auth: SessionAuth, newEmail: string, password: string, ctx: RequestContext) => Promise<void>
  /** Opens the link sent to the new address, for the account that is signed in. Returns the new address. */
  confirmEmailChange: (auth: SessionAuth, token: string, ctx: RequestContext) => Promise<string>
}

export function createOwnAccountService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly logger: Logger
  readonly limiter: RateLimiter
  readonly reauth: Reauthenticator
  readonly audit: Auditor
  readonly mail: SafeMail
  readonly minimumResponseMs: number
  readonly onInvalidSetting?: (key: string) => void
}): OwnAccountService {
  const { db, clock, logger, limiter, reauth, audit, mail, minimumResponseMs, onInvalidSetting } = options

  return {
    async changePassword(auth, current, next, ctx) {
      await reauth.password(auth, current, ctx)
      if (isTooObvious(next, auth.account)) {
        throw new WeakPasswordError()
      }
      const passwordHash = await hashPassword(next)
      await inTransaction(db, async (tx) => {
        const now = clock()
        await setPassword(tx, auth.account.id, passwordHash, now)
        // Links asked for with the old password (a pending e-mail change, a reset) are void, and the other sessions go: the
        // reason to change a password is often that someone else may have it.
        await invalidateUnusedTokens(tx, auth.account.id, now)
        const revoked = await deleteOtherSessions(tx, auth.account.id, auth.session.id)
        await audit(tx, ctx, {
          actor: auth.account,
          action: 'password.changed',
          objectType: 'account',
          objectId: auth.account.id,
          newValue: { otherSessionsRevoked: revoked },
        })
      })
      if ((await readSettings(db, NoticeSettings, onInvalidSetting)).notify_admin_password_change) {
        try {
          for (const admin of await listAdministrators(db)) {
            if (admin.id !== auth.account.id) {
              await mail({
                template: 'admin_password_change',
                to: admin.email,
                data: { username: auth.account.username },
              })
            }
          }
        } catch (err) {
          logger.error(
            { errorName: err instanceof Error ? err.name : 'unknown' },
            'could not notify the administrators',
          )
        }
      }
    },

    requestEmailChange(auth, newEmail, password, ctx) {
      return withMinimumDuration(minimumResponseMs, async () => {
        await reauth.password(auth, password, ctx)
        const target = newEmail.trim()
        if (target.toLowerCase() === auth.account.email.toLowerCase()) {
          // Nothing to change. Not a secret: it is the person's own address.
          throw new AppError(400, 'same_email', 'That is already the address of the account')
        }
        const taken = await emailInUse(db, target, auth.account.id)
        if (taken) {
          // The answer must not say that the address has an account (K-004): the owner is told by mail instead.
          const owner = await findAccountByEmail(db, target)
          if (owner !== undefined && owner.status !== 'disabled') {
            await mail({ template: 'account_exists', to: owner.email, data: { username: owner.username } })
          }
          return
        }
        const token = generateToken()
        await inTransaction(db, async (tx) => {
          const now = clock()
          await invalidateUnusedTokens(tx, auth.account.id, now, ['email_change'])
          await insertAccountToken(tx, {
            accountId: auth.account.id,
            purpose: 'email_change',
            tokenHash: hashToken(token),
            newEmail: target,
            expiresAt: new Date(now.getTime() + ONE_TIME_LINK_HOURS * HOUR_MS),
            now,
          })
          await audit(tx, ctx, {
            actor: auth.account,
            action: 'email_change.requested',
            objectType: 'account',
            objectId: auth.account.id,
          })
        })
        // The link goes to the NEW address, so that opening it proves it is the person's. The OLD address is told, so its
        // owner can react before anything changes.
        await mail({ template: 'email_change', to: target, data: { username: auth.account.username, token } })
        await mail({
          template: 'email_change_notice',
          to: auth.account.email,
          data: { username: auth.account.username, newEmail: target },
        })
      })
    },

    async confirmEmailChange(auth, token, ctx) {
      // Whoever holds the link still has to be signed in as the account: a link read over someone's shoulder or found in a
      // forwarded mail does nothing alone. Counted like any guess at a token.
      const ticket = await limiter.begin('password_lost', { ip: ctx.ip })
      assertNotLocked(ticket.status, clock())
      try {
        return await inTransaction(db, async (tx) => {
          const now = clock()
          const found = await findTokenForUpdate(tx, hashToken(token))
          if (
            found?.purpose !== 'email_change' ||
            found.accountId !== auth.account.id ||
            found.newEmail === null ||
            found.usedAt !== null ||
            found.expiresAt.getTime() <= now.getTime()
          ) {
            throw new InvalidTokenError()
          }
          if (!(await markTokenUsed(tx, found.id, now))) {
            throw new InvalidTokenError()
          }
          if (await emailInUse(tx, found.newEmail, auth.account.id)) {
            throw new AppError(409, 'email_unavailable', 'That address can no longer be used for this account')
          }
          await setEmail(tx, auth.account.id, found.newEmail, now)
          // Links mailed to the old address are void now.
          await invalidateUnusedTokens(tx, auth.account.id, now)
          await audit(tx, ctx, {
            actor: auth.account,
            action: 'email_change.confirmed',
            objectType: 'account',
            objectId: auth.account.id,
          })
          return found.newEmail
        })
      } catch (err) {
        // The address was taken between the request and the click.
        if (uniqueViolation(err) !== undefined) {
          throw new AppError(409, 'email_unavailable', 'That address can no longer be used for this account')
        }
        throw err
      }
    },
  }
}
