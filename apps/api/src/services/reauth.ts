// Proof that the person at the keyboard still has the password, for every change that would let a stolen session take the
// account over: adding or removing a second factor, making new recovery codes, changing the password or the e-mail address
// (Tor, 2026-10-22; OWASP ASVS V7.5). Only the password counts: a code from the app is not accepted instead, because someone
// who holds a session and the phone is not necessarily the owner. A wrong answer is counted against the account and the
// address like a failed login, so a stolen session cannot be used to guess the password (K-026).
import { verifyPassword } from '@toascribe/auth'
import type { Database } from '@toascribe/db'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError } from '../lib/errors.ts'
import { findPasswordHash } from '../repositories/accounts.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed } from './support.ts'
import type { Auditor, RequestContext } from './support.ts'

/** The password or the code was wrong. 403, not 401: the session is fine, and a client that signs out on 401 must not here. */
export class InvalidProofError extends AppError {
  constructor(code: 'invalid_password' | 'invalid_code', message: string) {
    super(403, code, message)
  }
}

export interface Reauthenticator {
  /** The account's current password. Counts under the `login` limits. */
  password: (auth: SessionAuth, password: string, ctx: RequestContext) => Promise<void>
}

export function createReauthenticator(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly limiter: RateLimiter
  readonly audit: Auditor
}): Reauthenticator {
  const { db, clock, limiter, audit } = options

  return {
    async password(auth, password, ctx) {
      const ticket = await limiter.begin('login', { ip: ctx.ip, accountId: auth.account.id })
      assertNotDelayed(ticket.status, clock())
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
  }
}
