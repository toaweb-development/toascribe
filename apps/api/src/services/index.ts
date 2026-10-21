import type { Database } from '@toascribe/db'
import type { KeyRing } from '@toascribe/shared'

import type { MailPort } from '../ports/mail.ts'
import { createAuthService } from './auth.ts'
import type { AuthService } from './auth.ts'
import { createMeService } from './me.ts'
import type { MeService } from './me.ts'
import { createRateLimiter } from './rate-limit.ts'
import type { RateLimiter } from './rate-limit.ts'
import { createSessionService } from './sessions.ts'
import type { SessionService } from './sessions.ts'

export interface ServiceDeps {
  readonly db: Database
  readonly clock: () => Date
  /** HMAC key for CSRF tokens (TOASCRIBE_SIGNING_KEY). */
  readonly signingKey: Uint8Array
  /** Field encryption (TOASCRIBE_ENCRYPTION_KEY and the older keys). */
  readonly keyRing: KeyRing
  readonly mail: MailPort
  /** Told about a stored setting that failed validation, so it can be logged. */
  readonly onInvalidSetting?: (key: string) => void
}

/** Everything the routes and the later flows (MFA, lost password, registration) build on, made once at start-up. */
export interface Services {
  readonly sessions: SessionService
  readonly auth: AuthService
  readonly me: MeService
  /** Per IP and per account limits for login, second factor, registration and lost password (K-026, K-313). */
  readonly limiter: RateLimiter
  readonly keyRing: KeyRing
  readonly mail: MailPort
}

export function createServices(deps: ServiceDeps): Services {
  const { db, clock } = deps
  const limiter = createRateLimiter(db, clock, deps.onInvalidSetting)
  const sessions = createSessionService({ db, clock, signingKey: deps.signingKey })
  return {
    sessions,
    auth: createAuthService({ db, clock, sessions, limiter }),
    me: createMeService({ db, clock }),
    limiter,
    keyRing: deps.keyRing,
    mail: deps.mail,
  }
}
