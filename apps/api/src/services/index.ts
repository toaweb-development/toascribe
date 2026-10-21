import type { Database } from '@toascribe/db'
import type { KeyRing } from '@toascribe/shared'
import type { Logger } from 'pino'

import { ACCOUNT_FLOW_MINIMUM_MS } from '../lib/timing.ts'
import type { MailPort } from '../ports/mail.ts'
import { createPublicFlows } from './account-links.ts'
import type { PublicFlows } from './account-links.ts'
import { createAuthService } from './auth.ts'
import type { AuthService } from './auth.ts'
import { createMeService } from './me.ts'
import type { MeService } from './me.ts'
import { createMfaService } from './mfa.ts'
import type { MfaService } from './mfa.ts'
import { createOwnAccountService } from './own-account.ts'
import type { OwnAccountService } from './own-account.ts'
import { createRateLimiter } from './rate-limit.ts'
import type { RateLimiter } from './rate-limit.ts'
import { createReauthenticator } from './reauth.ts'
import { createSessionService } from './sessions.ts'
import type { SessionService } from './sessions.ts'
import { createAuditor, createSafeMail } from './support.ts'
import { createSystemService } from './system.ts'
import type { SystemService } from './system.ts'
import { createTotpChecker } from './totp.ts'

export interface ServiceDeps {
  readonly db: Database
  readonly clock: () => Date
  /** HMAC key for CSRF tokens (TOASCRIBE_SIGNING_KEY). */
  readonly signingKey: Uint8Array
  /** Field encryption (TOASCRIBE_ENCRYPTION_KEY and the older keys). */
  readonly keyRing: KeyRing
  readonly mail: MailPort
  readonly logger: Logger
  /** PUBLIC_ORIGIN: the issuer line of the authenticator app falls back to its host. */
  readonly publicOrigin: string
  /** How long the flows that hide whether an account exists take at least, in milliseconds. Tests set 0; the default is ACCOUNT_FLOW_MINIMUM_MS. */
  readonly minimumResponseMs?: number
  /** Told about a stored setting that failed validation, so it can be logged. */
  readonly onInvalidSetting?: (key: string) => void
}

/** Everything the routes and the later flows (MFA, lost password, registration) build on, made once at start-up. */
export interface Services {
  readonly sessions: SessionService
  readonly auth: AuthService
  readonly me: MeService
  readonly system: SystemService
  /** Second factor: enrolment, recovery codes, the second step of a login (K-023). */
  readonly mfa: MfaService
  /** Lost password, first password, registration (K-003, K-005). */
  readonly flows: PublicFlows
  /** Password and e-mail of the signed-in account (K-012, K-013). */
  readonly ownAccount: OwnAccountService
  /** Per IP and per account limits for login, second factor, registration and lost password (K-026, K-313). */
  readonly limiter: RateLimiter
  readonly keyRing: KeyRing
  readonly mail: MailPort
}

export function createServices(deps: ServiceDeps): Services {
  const { db, clock } = deps
  const limiter = createRateLimiter(db, clock, deps.onInvalidSetting)
  const sessions = createSessionService({ db, clock, signingKey: deps.signingKey })
  const audit = createAuditor(clock)
  const mail = createSafeMail(deps.mail, deps.logger)
  const minimumResponseMs = deps.minimumResponseMs ?? ACCOUNT_FLOW_MINIMUM_MS
  const totp = createTotpChecker({ clock, keyRing: deps.keyRing, logger: deps.logger })
  const reauth = createReauthenticator({ db, clock, limiter, totp, audit })
  return {
    sessions,
    auth: createAuthService({ db, clock, sessions, limiter }),
    me: createMeService({ db, clock }),
    system: createSystemService({ db, clock, mail: deps.mail }),
    mfa: createMfaService({
      db,
      clock,
      keyRing: deps.keyRing,
      logger: deps.logger,
      publicOrigin: deps.publicOrigin,
      sessions,
      limiter,
      totp,
      reauth,
      audit,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    flows: createPublicFlows({
      db,
      clock,
      logger: deps.logger,
      limiter,
      audit,
      mail,
      minimumResponseMs,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    ownAccount: createOwnAccountService({
      db,
      clock,
      logger: deps.logger,
      limiter,
      reauth,
      audit,
      mail,
      minimumResponseMs,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    limiter,
    keyRing: deps.keyRing,
    mail: deps.mail,
  }
}
