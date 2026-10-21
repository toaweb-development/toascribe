// Proof that the person at the keyboard still has the password or the authenticator app, for the changes that would let a
// stolen session take the account over: changing the password or the e-mail address, removing a factor, making new recovery
// codes. A wrong answer is counted against the account and the address like a failed login, so a stolen session cannot be
// used to guess the password (K-026).
import type { Database } from '@toascribe/db'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError } from '../lib/errors.ts'
import { verifyPassword } from '../lib/passwords.ts'
import { findPasswordHash } from '../repositories/accounts.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotLocked } from './support.ts'
import type { Auditor, RequestContext } from './support.ts'
import type { TotpChecker } from './totp.ts'

/** The password or the code was wrong. 403, not 401: the session is fine, and a client that signs out on 401 must not here. */
export class InvalidProofError extends AppError {
  constructor(code: 'invalid_password' | 'invalid_code', message: string) {
    super(403, code, message)
  }
}

export type Proof = { readonly password: string } | { readonly code: string }

export interface Reauthenticator {
  /** The account's current password. Counts under the `login` limits. */
  password: (auth: SessionAuth, password: string, ctx: RequestContext) => Promise<void>
  /** A fresh code from the app. Counts under the `mfa` limits. */
  code: (auth: SessionAuth, code: string, ctx: RequestContext) => Promise<void>
  either: (auth: SessionAuth, proof: Proof, ctx: RequestContext) => Promise<void>
}

export function createReauthenticator(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly limiter: RateLimiter
  readonly totp: TotpChecker
  readonly audit: Auditor
}): Reauthenticator {
  const { db, clock, limiter, totp, audit } = options

  const reauth: Reauthenticator = {
    async password(auth, password, ctx) {
      const ticket = await limiter.begin('login', { ip: ctx.ip, accountId: auth.account.id })
      assertNotLocked(ticket.status, clock())
      const stored = await findPasswordHash(db, auth.account.id)
      const check = stored === null ? { valid: false as const } : await verifyPassword(password, stored)
      if (!check.valid) {
        await audit(db, ctx, {
          actor: auth.account,
          action: 'reauth.failed',
          objectType: 'account',
          objectId: auth.account.id,
          reason: 'wrong_password',
        })
        throw new InvalidProofError('invalid_password', 'The password is wrong')
      }
      await limiter.succeed(ticket)
    },

    async code(auth, code, ctx) {
      const ticket = await limiter.begin('mfa', { ip: ctx.ip, accountId: auth.account.id })
      assertNotLocked(ticket.status, clock())
      const check = await totp.consume(db, auth.account.id, code)
      if (!check.ok) {
        await audit(db, ctx, {
          actor: auth.account,
          action: 'reauth.failed',
          objectType: 'account',
          objectId: auth.account.id,
          reason: check.reason === 'replayed' ? 'code_replayed' : 'wrong_code',
        })
        throw new InvalidProofError('invalid_code', 'The code is wrong or has been used')
      }
      await limiter.succeed(ticket)
    },

    either(auth, proof, ctx) {
      return 'password' in proof ? reauth.password(auth, proof.password, ctx) : reauth.code(auth, proof.code, ctx)
    },
  }
  return reauth
}
