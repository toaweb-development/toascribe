// The second factor (K-023): enrolling an authenticator app, listing and removing factors, recovery codes, and passing the
// second step of a login. The service knows nothing about HTTP.
//
// The login state machine (the session decides, on every request, see sessions.ts `resolveMfaStatus`):
//   password right  -> POST /auth/login makes a session that lives 10 minutes and answers `mfa_required` with
//                      `verification` (the account has a factor) or `enrolment` (its role requires one and it has none)
//   verification    -> POST /auth/mfa/verify with a code or a recovery code -> complete session, new token
//   enrolment       -> POST /me/mfa/totp, then POST /me/mfa/totp/{id}/confirm -> complete session, new token
// A session in either state may do nothing else but log out (the policy guard answers 401 `mfa_required`). A session in
// `verification` may not enrol: otherwise a stolen password would be enough to add a factor of the thief's own.
//
// Re-authentication (Tor, 2026-10-22): in a complete session (`ok`) adding a factor, removing one and making new recovery codes
// all need the current password, and each sends the owner a notice before the change. The `enrolment` state is the one place
// where the password is not asked again: it was given at the login a moment ago, and the session can do nothing else.
import type { Database } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import type {
  KeyRing,
  MfaConfirmResponse,
  MfaEnrolStartResponse,
  MfaFactor,
  MfaListResponse,
  MfaVerifyRequest,
  RecoveryCodesResponse,
  SecurityNoticeAction,
} from '@toascribe/shared'
import type { Logger } from 'pino'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../lib/recovery-codes.ts'
import { generateTotpSecret, matchTotpStep, qrSvg, totpUri } from '../lib/totp.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { Executor } from '../repositories/executor.ts'
import {
  confirmCredential,
  countConfirmedFactors,
  countUnusedRecoveryCodes,
  deleteConfirmedFactor,
  deleteRecoveryCodes,
  deleteUnconfirmedCredentials,
  findConfirmedFactor,
  findUnconfirmedCredential,
  hasRecoveryCodeRows,
  insertUnconfirmedCredential,
  listConfirmedFactors,
  recordTotpStep,
  replaceRecoveryCodes,
  useRecoveryCode,
} from '../repositories/mfa.ts'
import type { TotpFactor } from '../repositories/mfa.ts'
import { readSettings } from '../repositories/settings.ts'
import { InvalidProofError } from './reauth.ts'
import type { Reauthenticator } from './reauth.ts'
import type { RateLimiter } from './rate-limit.ts'
import type { IssuedToken, SessionService } from './sessions.ts'
import { assertNotDelayed } from './support.ts'
import type { Auditor, RequestContext, SafeMail } from './support.ts'
import { mfaSecretAad } from './totp.ts'
import type { TotpChecker } from './totp.ts'

/** At most this many enrolled authenticator apps per account. */
export const MAX_FACTORS = 5

const MfaSettings = CoreSettings.pick({ mfa_required_roles: true, blogname: true })

export interface VerifiedLogin {
  readonly issued: IssuedToken
  /** Unused recovery codes left; null when a code from the app was used. */
  readonly recoveryCodesRemaining: number | null
}

export interface ConfirmedEnrolment extends Omit<MfaConfirmResponse, 'loginCompleted'> {
  /** The new token when the call finished a half-done login; the route sets the cookie. */
  readonly issued: IssuedToken | undefined
}

export interface MfaService {
  list: (auth: SessionAuth) => Promise<MfaListResponse>
  startEnrolment: (auth: SessionAuth, name: string | undefined, ctx: RequestContext) => Promise<MfaEnrolStartResponse>
  confirmEnrolment: (
    auth: SessionAuth,
    credentialId: string,
    code: string,
    /** The account's current password; required in a complete session, ignored in the `enrolment` state. */
    password: string | undefined,
    ctx: RequestContext,
  ) => Promise<ConfirmedEnrolment>
  remove: (auth: SessionAuth, credentialId: string, password: string, ctx: RequestContext) => Promise<void>
  regenerateRecoveryCodes: (auth: SessionAuth, password: string, ctx: RequestContext) => Promise<RecoveryCodesResponse>
  /** The second step of a login. */
  verify: (auth: SessionAuth, request: MfaVerifyRequest, ctx: RequestContext) => Promise<VerifiedLogin>
}

function toFactor(factor: TotpFactor): MfaFactor {
  return {
    id: factor.id,
    type: 'totp',
    name: factor.name,
    createdAt: factor.createdAt.toISOString(),
    lastUsedAt: factor.lastUsedAt?.toISOString() ?? null,
  }
}

function siteLabel(blogname: string, publicOrigin: string): string {
  const name = blogname.trim()
  return name === '' ? new URL(publicOrigin).host : name
}

/** A session that has the password but not yet the second factor, and the account already has one, may not manage factors. */
function assertMayManageFactors(auth: SessionAuth): void {
  if (auth.mfa === 'verification') {
    throw new UnauthorizedError('A second factor is required', 'mfa_required')
  }
}

export function createMfaService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly keyRing: KeyRing
  readonly logger: Logger
  readonly publicOrigin: string
  readonly sessions: SessionService
  readonly limiter: RateLimiter
  readonly totp: TotpChecker
  readonly reauth: Reauthenticator
  readonly audit: Auditor
  /** For the notice to the owner before a factor or the recovery codes change. */
  readonly mail: SafeMail
  readonly onInvalidSetting?: (key: string) => void
}): MfaService {
  const { db, clock, keyRing, publicOrigin, sessions, limiter, totp, reauth, audit, mail, onInvalidSetting } = options

  async function requiredByRole(auth: SessionAuth): Promise<boolean> {
    const settings = await readSettings(db, MfaSettings, onInvalidSetting)
    return auth.roles.some((slug) => settings.mfa_required_roles.includes(slug))
  }

  /** The notice to the account's own address, queued just before the change it tells about is written. */
  function notify(auth: SessionAuth, action: SecurityNoticeAction): Promise<void> {
    return mail({
      template: 'security_notice',
      to: auth.account.email,
      data: { username: auth.account.username, action },
    })
  }

  /** A fresh set of codes, hashed into the table in the caller's transaction. Returns them as printed. */
  async function issueRecoveryCodes(tx: Executor, accountId: string): Promise<string[]> {
    const codes = generateRecoveryCodes()
    const hashes = codes.map((code) => {
      const normalized = normalizeRecoveryCode(code)
      if (normalized === undefined) {
        throw new Error('a generated recovery code did not normalise')
      }
      return hashRecoveryCode(accountId, normalized)
    })
    await replaceRecoveryCodes(tx, accountId, hashes, clock())
    return codes
  }

  return {
    async list(auth) {
      const [factors, remaining, required] = await Promise.all([
        listConfirmedFactors(db, auth.account.id),
        countUnusedRecoveryCodes(db, auth.account.id),
        requiredByRole(auth),
      ])
      return { factors: factors.map(toFactor), recoveryCodesRemaining: remaining, required }
    },

    async startEnrolment(auth, name, ctx) {
      assertMayManageFactors(auth)
      if ((await countConfirmedFactors(db, auth.account.id)) >= MAX_FACTORS) {
        throw new AppError(409, 'too_many_factors', 'The account has as many authenticator apps as it can have')
      }
      const settings = await readSettings(db, MfaSettings, onInvalidSetting)
      const credentialId = crypto.randomUUID()
      const secret = generateTotpSecret()
      const secretEncrypted = await keyRing.encrypt(secret, mfaSecretAad(credentialId))
      await inTransaction(db, async (tx) => {
        // A new start replaces an unfinished one, so an account never has more than one.
        await deleteUnconfirmedCredentials(tx, auth.account.id)
        await insertUnconfirmedCredential(tx, {
          id: credentialId,
          accountId: auth.account.id,
          name: name === undefined || name.trim() === '' ? null : name.trim(),
          secretEncrypted,
          now: clock(),
        })
        await audit(tx, ctx, {
          actor: auth.account,
          action: 'mfa.enrolment_started',
          objectType: 'mfa_credential',
          objectId: credentialId,
        })
      })
      const uri = totpUri(secret, siteLabel(settings.blogname, publicOrigin), auth.account.username)
      return { id: credentialId, secret, uri, qrSvg: qrSvg(uri) }
    },

    async confirmEnrolment(auth, credentialId, code, password, ctx) {
      assertMayManageFactors(auth)
      if (auth.mfa === 'ok') {
        // A complete session: adding a factor of one's own is the way to lock the owner out, so the password is asked again.
        if (password === undefined) {
          throw new AppError(400, 'password_required', 'Enter your password to add an authenticator app')
        }
        await reauth.password(auth, password, ctx)
      }
      const ticket = await limiter.begin('mfa', { ip: ctx.ip, accountId: auth.account.id })
      assertNotDelayed(ticket.status, clock())

      const credential = await findUnconfirmedCredential(db, auth.account.id, credentialId)
      if (credential === undefined) {
        throw new NotFoundError('No such enrolment')
      }
      let secret: string
      try {
        secret = await keyRing.decrypt(credential.secretEncrypted, mfaSecretAad(credential.id))
      } catch {
        throw new AppError(409, 'enrolment_unreadable', 'Start the enrolment again')
      }
      const now = clock()
      const step = matchTotpStep(secret, code, now.getTime())
      if (step === null) {
        await audit(db, ctx, {
          actor: auth.account,
          action: 'mfa.enrolment_failed',
          objectType: 'mfa_credential',
          objectId: credential.id,
          reason: 'wrong_code',
        })
        throw new InvalidProofError('invalid_code', 'The code is wrong')
      }

      return inTransaction(db, async (tx) => {
        // The owner is told before the factor is added (in the `enrolment` state too: the password was just given, but a notice
        // costs nothing).
        await notify(auth, 'mfa_added')
        // The step is recorded first, so the same code cannot also be used to log in during the same 30 seconds.
        const recorded = await recordTotpStep(tx, credential.id, step, now)
        const confirmed = recorded && (await confirmCredential(tx, credential.id, now))
        if (!confirmed) {
          throw new AppError(409, 'enrolment_finished', 'The enrolment was already finished')
        }
        const recoveryCodes = (await hasRecoveryCodeRows(tx, auth.account.id))
          ? null
          : await issueRecoveryCodes(tx, auth.account.id)
        const completes = auth.mfa === 'enrolment'
        const issued = completes
          ? await sessions.completeMfa(auth.session.id, auth.session.isRemembered, tx)
          : undefined
        if (completes && issued === undefined) {
          throw new UnauthorizedError()
        }
        if (!completes && auth.session.mfaVerifiedAt === null) {
          // The account has a factor from now on; this session passed it just now, the account's other sessions did not.
          await sessions.markMfaPassed(auth.session.id, tx)
        }
        await limiter.succeed(ticket, tx)
        await audit(tx, ctx, {
          actor: auth.account,
          action: 'mfa.enrolled',
          objectType: 'mfa_credential',
          objectId: credential.id,
          newValue: { recoveryCodesIssued: recoveryCodes !== null, loginCompleted: completes },
        })
        const factor = await findConfirmedFactor(tx, auth.account.id, credential.id)
        if (factor === undefined) {
          throw new Error('the enrolled factor vanished')
        }
        return { factor: toFactor(factor), recoveryCodes, issued }
      })
    },

    async remove(auth, credentialId, password, ctx) {
      await reauth.password(auth, password, ctx)
      await inTransaction(db, async (tx) => {
        const factor = await findConfirmedFactor(tx, auth.account.id, credentialId)
        if (factor === undefined) {
          throw new NotFoundError('No such factor')
        }
        const count = await countConfirmedFactors(tx, auth.account.id)
        if (count <= 1 && (await requiredByRole(auth))) {
          throw new AppError(
            409,
            'mfa_required_by_role',
            'A role of this account requires a second factor, so the last one cannot be removed',
          )
        }
        await notify(auth, 'mfa_removed')
        await deleteConfirmedFactor(tx, auth.account.id, credentialId)
        if (count <= 1) {
          // Recovery codes only mean something with a factor behind them.
          await deleteRecoveryCodes(tx, auth.account.id)
        }
        await audit(tx, ctx, {
          actor: auth.account,
          action: 'mfa.removed',
          objectType: 'mfa_credential',
          objectId: credentialId,
          newValue: { remaining: count - 1 },
        })
      })
    },

    async regenerateRecoveryCodes(auth, password, ctx) {
      await reauth.password(auth, password, ctx)
      return inTransaction(db, async (tx) => {
        if ((await countConfirmedFactors(tx, auth.account.id)) === 0) {
          throw new AppError(409, 'no_factor', 'Recovery codes need a second factor first')
        }
        await notify(auth, 'recovery_codes_regenerated')
        const recoveryCodes = await issueRecoveryCodes(tx, auth.account.id)
        await audit(tx, ctx, {
          actor: auth.account,
          action: 'mfa.recovery_codes_regenerated',
          objectType: 'account',
          objectId: auth.account.id,
        })
        return { recoveryCodes }
      })
    },

    async verify(auth, request, ctx) {
      if (auth.mfa !== 'verification') {
        throw new AppError(409, 'mfa_not_pending', 'This session has no second factor to pass')
      }
      // Counted before it is judged, like a login (see RateLimiter.begin). The person has the password already, so a
      // wait says so: there is nothing to keep secret.
      const ticket = await limiter.begin('mfa', { ip: ctx.ip, accountId: auth.account.id })
      assertNotDelayed(ticket.status, clock())

      const result = await inTransaction(db, async (tx) => {
        let failure: string | undefined
        let recoveryCodesRemaining: number | null = null
        if (request.type === 'totp') {
          const check = await totp.consume(tx, auth.account.id, request.code)
          if (!check.ok) {
            failure = check.reason === 'replayed' ? 'code_replayed' : 'wrong_code'
          }
        } else {
          const normalized = normalizeRecoveryCode(request.code)
          const used =
            normalized !== undefined &&
            (await useRecoveryCode(tx, auth.account.id, hashRecoveryCode(auth.account.id, normalized), clock()))
          if (used) {
            recoveryCodesRemaining = await countUnusedRecoveryCodes(tx, auth.account.id)
          } else {
            failure = 'wrong_recovery_code'
          }
        }
        if (failure !== undefined) {
          // Nothing consumed is kept: the transaction ends here and the failure is audited outside it.
          return { failure }
        }
        const issued = await sessions.completeMfa(auth.session.id, auth.session.isRemembered, tx)
        if (issued === undefined) {
          throw new UnauthorizedError()
        }
        await limiter.succeed(ticket, tx)
        await audit(tx, ctx, {
          actor: auth.account,
          action: request.type === 'totp' ? 'mfa.verified' : 'mfa.recovery_code_used',
          objectType: 'session',
          objectId: auth.session.id,
          ...(request.type === 'recovery' ? { newValue: { remaining: recoveryCodesRemaining } } : {}),
        })
        return { issued, recoveryCodesRemaining }
      })

      if ('failure' in result) {
        await audit(db, ctx, {
          actor: auth.account,
          action: 'mfa.verify_failed',
          objectType: 'session',
          objectId: auth.session.id,
          reason: result.failure,
        })
        throw new InvalidProofError('invalid_code', 'The code is wrong or has been used')
      }
      return { issued: result.issued, recoveryCodesRemaining: result.recoveryCodesRemaining }
    },
  }
}
