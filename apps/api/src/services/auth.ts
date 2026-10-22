// Login and logout (K-001, K-004, K-026, K-310). The service knows nothing about HTTP: it takes plain values and returns
// plain results, or throws a typed error that the error handler turns into the ApiError format.
import { dummyPasswordHash, hashPassword, verifyPassword } from '@toascribe/auth'
import type { Database } from '@toascribe/db'

import type { MfaStatus, SessionAuth } from '../lib/auth-context.ts'
import { UNKNOWN_IP } from '../lib/client-ip.ts'
import { UnauthorizedError } from '../lib/errors.ts'
import { findAccountByLogin, listRoleGrants, setPasswordHash } from '../repositories/accounts.ts'
import type { AccountView } from '../repositories/accounts.ts'
import { insertAuditEntry } from '../repositories/audit.ts'
import type { AuditEntry } from '../repositories/audit.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import type { RateLimiter } from './rate-limit.ts'
import type { IssuedSession, SessionService } from './sessions.ts'
import { assertNotDelayed } from './support.ts'

export interface LoginInput {
  /** What was typed in the first field: a username or an e-mail address. */
  readonly login: string
  readonly password: string
  readonly remember: boolean
  readonly ip: string
  readonly userAgent: string | null
  /** The request id, for the audit log and the log. */
  readonly requestId: string | undefined
}

/**
 * The outcome of a login that passed the password. `mfa` is `ok` for a full session. Otherwise the session is half done
 * (`verification` or `enrolment`) and the client must finish the second-factor step, which the MFA flows (task 4) own.
 */
export interface LoginSuccess {
  readonly issued: IssuedSession
  readonly account: AccountView
  readonly roles: readonly string[]
  readonly capabilities: readonly string[]
  readonly mfa: MfaStatus
}

/**
 * The one answer to a failed login (K-004): the same status, code and text whether the account exists, the password was
 * wrong or the account is not active. The reason goes to the audit log only.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Invalid username or password', 'invalid_credentials')
  }
}

export interface AuthService {
  login: (input: LoginInput) => Promise<LoginSuccess>
  /** Ends the session and writes the audit entry. */
  logout: (auth: SessionAuth, ip: string, requestId: string | undefined) => Promise<void>
  /** Ends one of the account's sessions (`DELETE /me/sessions/{id}`). False when it is not theirs or not there. */
  revokeSession: (auth: SessionAuth, sessionId: string, ip: string, requestId: string | undefined) => Promise<boolean>
  /** Ends all the others (`DELETE /me/sessions`). */
  revokeOtherSessions: (auth: SessionAuth, ip: string, requestId: string | undefined) => Promise<number>
}

export function createAuthService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly sessions: SessionService
  readonly limiter: RateLimiter
}): AuthService {
  const { db, clock, sessions, limiter } = options

  /** The rate limiter counts requests with no readable address in one bucket (UNKNOWN_IP); the audit log and the session list show «unknown» as nothing. */
  const shown = (ip: string): string | null => (ip === UNKNOWN_IP ? null : ip)

  function audit(db2: Executor, entry: Omit<AuditEntry, 'at' | 'source'>): Promise<void> {
    return insertAuditEntry(db2, { ...entry, source: 'api', at: clock() })
  }

  return {
    async login(input) {
      const account = await findAccountByLogin(db, input.login)

      // Counts this attempt before it is judged (see RateLimiter.begin), so a burst of parallel guesses cannot all slip in.
      const attempt = await limiter.begin('login', {
        ip: input.ip,
        accountId: account?.id ?? null,
        login: input.login,
      })
      // An address or a login name that has failed too often has to wait (429, Retry-After). The wait of a name that matches no
      // account is counted exactly like a real one, so this answer does not depend on whether the account exists (K-004).
      assertNotDelayed(attempt.status, clock())

      // The same work whether or not the account exists or has a password: always one hash check (K-004).
      const stored = account?.passwordHash ?? (await dummyPasswordHash())
      const check = await verifyPassword(input.password, stored)

      let reason: 'ok' | 'unknown_account' | 'no_password' | 'wrong_password' | 'account_inactive' = 'ok'
      if (account === undefined) {
        reason = 'unknown_account'
      } else if (account.passwordHash === null) {
        reason = 'no_password'
      } else if (!check.valid) {
        reason = 'wrong_password'
      } else if (account.status !== 'active') {
        reason = 'account_inactive'
      }

      if (account === undefined || reason !== 'ok' || !check.valid) {
        // The attempt is already counted as a failure.
        await audit(db, {
          actorType: account === undefined ? 'system' : 'account',
          // The typed name is not stored for an unknown account: people type passwords in that field.
          actor: account?.username ?? 'anonymous',
          accountId: account?.id ?? null,
          action: 'login.failed',
          objectType: 'account',
          ...(account === undefined ? {} : { objectId: account.id }),
          reason,
          ...(input.requestId === undefined ? {} : { correlationId: input.requestId }),
          ip: shown(input.ip),
        })
        throw new InvalidCredentialsError()
      }

      // Hashing first (it takes tens of milliseconds) so the transaction stays short.
      const upgrade = check.needsRehash ? await hashPassword(input.password) : undefined

      const result = await inTransaction(db, async (tx) => {
        if (upgrade !== undefined) {
          await setPasswordHash(tx, account.id, upgrade, clock())
        }
        const issued = await sessions.issue(
          { account, remember: input.remember, ip: shown(input.ip), userAgent: input.userAgent },
          tx,
        )
        const grants = await listRoleGrants(tx, account.id)
        await limiter.succeed(attempt, tx)
        await audit(tx, {
          actorType: 'account',
          actor: account.username,
          accountId: account.id,
          action: issued.mfa === 'ok' ? 'login.succeeded' : 'login.password_accepted',
          objectType: 'session',
          objectId: issued.session.id,
          newValue: { remember: input.remember, passwordUpgraded: upgrade !== undefined, mfa: issued.mfa },
          ...(input.requestId === undefined ? {} : { correlationId: input.requestId }),
          ip: shown(input.ip),
        })
        return { issued, grants }
      })

      return {
        issued: result.issued,
        account,
        roles: result.grants.map((grant) => grant.slug),
        capabilities: [...new Set(result.grants.flatMap((grant) => grant.capabilities))].sort(),
        mfa: result.issued.mfa,
      }
    },

    async logout(auth, ip, requestId) {
      await inTransaction(db, async (tx) => {
        await sessions.revoke(auth.account.id, auth.session.id, tx)
        await audit(tx, {
          actorType: 'account',
          actor: auth.account.username,
          accountId: auth.account.id,
          action: 'logout',
          objectType: 'session',
          objectId: auth.session.id,
          ...(requestId === undefined ? {} : { correlationId: requestId }),
          ip: shown(ip),
        })
      })
    },

    async revokeSession(auth, sessionId, ip, requestId) {
      return inTransaction(db, async (tx) => {
        const deleted = await sessions.revoke(auth.account.id, sessionId, tx)
        if (deleted) {
          await audit(tx, {
            actorType: 'account',
            actor: auth.account.username,
            accountId: auth.account.id,
            action: 'session.revoked',
            objectType: 'session',
            objectId: sessionId,
            ...(requestId === undefined ? {} : { correlationId: requestId }),
            ip: shown(ip),
          })
        }
        return deleted
      })
    },

    async revokeOtherSessions(auth, ip, requestId) {
      return inTransaction(db, async (tx) => {
        const count = await sessions.revokeOthers(auth, tx)
        if (count > 0) {
          await audit(tx, {
            actorType: 'account',
            actor: auth.account.username,
            accountId: auth.account.id,
            action: 'session.revoked_others',
            objectType: 'session',
            newValue: { count },
            ...(requestId === undefined ? {} : { correlationId: requestId }),
            ip: shown(ip),
          })
        }
        return count
      })
    },
  }
}
