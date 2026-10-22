// Sessions (K-001, K-002, K-013; security §3). The cookie holds a random token, the database its SHA-256. The expiry is
// fixed when the session is made, from the settings, and is not extended by use: WordPress sessions end the same way.
import { csrfTokenFor, generateToken, hashToken } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import type { SessionListItem } from '@toascribe/shared'
import type { Logger } from 'pino'
import type { z } from 'zod'

import { ANONYMOUS } from '../lib/auth-context.ts'
import type { AuthContext, MfaStatus, SessionAuth } from '../lib/auth-context.ts'
import { hasConfirmedMfaFactor, listRoleGrants } from '../repositories/accounts.ts'
import type { AccountView } from '../repositories/accounts.ts'
import type { Executor } from '../repositories/executor.ts'
import { readSettings } from '../repositories/settings.ts'
import {
  deleteOtherSessions,
  deleteOwnSession,
  findLiveSession,
  insertSession,
  markSessionMfaVerified,
  listLiveSessions,
  replaceTokenAfterMfa,
  touchSession,
} from '../repositories/sessions.ts'
import type { SessionRecord } from '../repositories/sessions.ts'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * How long a session that has passed the password but not the second factor lives. A hard limit, not a setting: it is
 * the time to find the phone, and a stolen half-session should not outlive it.
 */
export const PENDING_MFA_SESSION_MINUTES = 10

/**
 * How often `last_seen_at` is written. «Active sessions» shows when a device was last used; a minute-exact value is not
 * worth a write on every request, so a request writes only when the stored value is older than this.
 */
export const LAST_SEEN_THROTTLE_MINUTES = 5

/** A user agent longer than this is cut. It is shown in «active sessions», not parsed. */
const MAX_USER_AGENT_LENGTH = 512

export const SessionSettings = CoreSettings.pick({
  session_lifetime_days: true,
  session_lifetime_remember_days: true,
  mfa_required_roles: true,
})
export type SessionSettings = z.infer<typeof SessionSettings>

export interface IssuedSession {
  /** The token for the cookie. It exists only here: the database keeps its hash. */
  readonly token: string
  readonly session: SessionRecord
  readonly mfa: MfaStatus
  /** Seconds the cookie should live, or undefined for a browser-session cookie. */
  readonly cookieMaxAgeSeconds: number | undefined
}

export interface IssueSessionInput {
  readonly account: AccountView
  readonly remember: boolean
  readonly ip: string | null
  readonly userAgent: string | null
}

export interface SessionService {
  /** Makes a session for an account that has just passed its password. Pass the transaction so it commits with the audit row. */
  issue: (input: IssueSessionInput, db?: Executor) => Promise<IssuedSession>
  /** The live session and the person behind a cookie token, or anonymous. Throws only for a database failure. */
  authenticate: (token: string, logger: Logger) => Promise<AuthContext>
  csrfToken: (sessionId: string) => string
  list: (auth: SessionAuth) => Promise<SessionListItem[]>
  /** Ends one of the account's own sessions. False when it has no such session. */
  revoke: (accountId: string, sessionId: string, db?: Executor) => Promise<boolean>
  /** Ends every session of the account but this one. Returns how many. */
  revokeOthers: (auth: SessionAuth, db?: Executor) => Promise<number>
  /**
   * Seam for the second-factor flows (task 4): after the factor is verified or enrolled, marks the session as passed, gives
   * it a new token (a token that was seen before the factor must not become a full session) and the full lifetime. The
   * caller sets the cookie. Returns undefined when the session has gone.
   */
  completeMfa: (sessionId: string, remember: boolean, db?: Executor) => Promise<IssuedToken | undefined>
  /**
   * For a complete session whose account has just enrolled its first factor: the person proved the code a moment ago, so this
   * session counts as having passed it (it keeps its token). The account's other sessions are not marked: they have to pass
   * the factor like any new login.
   */
  markMfaPassed: (sessionId: string, db?: Executor) => Promise<void>
}

export interface IssuedToken {
  readonly token: string
  readonly expiresAt: Date
  readonly cookieMaxAgeSeconds: number | undefined
}

/** The status of the second-factor step for an account (see MfaStatus). */
export async function resolveMfaStatus(
  db: Executor,
  accountId: string,
  roles: readonly string[],
  requiredRoles: readonly string[],
  mfaVerifiedAt: Date | null,
): Promise<MfaStatus> {
  const hasFactor = await hasConfirmedMfaFactor(db, accountId)
  const roleRequires = roles.some((slug) => requiredRoles.includes(slug))
  if (!hasFactor && !roleRequires) {
    return 'ok'
  }
  if (mfaVerifiedAt !== null) {
    return 'ok'
  }
  return hasFactor ? 'verification' : 'enrolment'
}

function toListItem(record: SessionRecord, currentId: string): SessionListItem {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    ip: record.ip,
    userAgent: record.userAgent,
    isRemembered: record.isRemembered,
    isCurrent: record.id === currentId,
  }
}

export function cleanUserAgent(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null
  }
  // Control characters out, so the value is safe in a log line and on a screen.
  const cleaned = raw
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, MAX_USER_AGENT_LENGTH)
  return cleaned === '' ? null : cleaned
}

export function createSessionService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly signingKey: Uint8Array
}): SessionService {
  const { db, clock, signingKey } = options

  function lifetimeMs(settings: SessionSettings, remember: boolean): number {
    return (remember ? settings.session_lifetime_remember_days : settings.session_lifetime_days) * DAY_MS
  }

  return {
    async issue(input, executor = db) {
      const now = clock()
      const settings = await readSettings(executor, SessionSettings)
      const grants = await listRoleGrants(executor, input.account.id)
      const mfa = await resolveMfaStatus(
        executor,
        input.account.id,
        grants.map((grant) => grant.slug),
        settings.mfa_required_roles,
        null,
      )
      const pending = mfa !== 'ok'
      const lifetime = pending ? PENDING_MFA_SESSION_MINUTES * MINUTE_MS : lifetimeMs(settings, input.remember)
      const token = generateToken()
      const session = await insertSession(executor, {
        accountId: input.account.id,
        tokenHash: hashToken(token),
        ip: input.ip,
        userAgent: cleanUserAgent(input.userAgent),
        expiresAt: new Date(now.getTime() + lifetime),
        mfaVerifiedAt: null,
        isRemembered: input.remember,
        now,
      })
      return {
        token,
        session,
        mfa,
        cookieMaxAgeSeconds: input.remember && !pending ? Math.floor(lifetime / 1000) : undefined,
      }
    },

    async authenticate(token, logger) {
      const now = clock()
      const found = await findLiveSession(db, hashToken(token), now)
      if (found?.account.status !== 'active') {
        return ANONYMOUS
      }
      const grants = await listRoleGrants(db, found.account.id)
      const roles = grants.map((grant) => grant.slug)
      const settings = await readSettings(db, SessionSettings, (key) => {
        logger.warn({ key }, 'a stored setting is invalid; the default is used')
      })
      const mfa = await resolveMfaStatus(
        db,
        found.account.id,
        roles,
        settings.mfa_required_roles,
        found.session.mfaVerifiedAt,
      )

      const staleBefore = new Date(now.getTime() - LAST_SEEN_THROTTLE_MINUTES * MINUTE_MS)
      if (found.session.lastSeenAt < staleBefore) {
        try {
          await touchSession(db, found.session.id, now, staleBefore)
        } catch (err) {
          // Not worth failing the request for; the session is valid.
          logger.warn({ err }, 'could not update the last-seen time of a session')
        }
      }

      return {
        kind: 'session',
        account: found.account,
        roles,
        capabilities: new Set(grants.flatMap((grant) => grant.capabilities)),
        session: found.session,
        mfa,
        via: 'cookie',
      }
    },

    csrfToken(sessionId) {
      return csrfTokenFor(signingKey, sessionId)
    },

    async list(auth) {
      const sessions = await listLiveSessions(db, auth.account.id, clock())
      return sessions.map((record) => toListItem(record, auth.session.id))
    },

    revoke(accountId, sessionId, executor = db) {
      return deleteOwnSession(executor, accountId, sessionId)
    },

    revokeOthers(auth, executor = db) {
      return deleteOtherSessions(executor, auth.account.id, auth.session.id)
    },

    async markMfaPassed(sessionId, executor = db) {
      await markSessionMfaVerified(executor, sessionId, clock())
    },

    async completeMfa(sessionId, remember, executor = db) {
      const now = clock()
      const settings = await readSettings(executor, SessionSettings)
      const token = generateToken()
      const expiresAt = new Date(now.getTime() + lifetimeMs(settings, remember))
      const done = await replaceTokenAfterMfa(executor, sessionId, hashToken(token), expiresAt, now)
      if (!done) {
        return undefined
      }
      return {
        token,
        expiresAt,
        cookieMaxAgeSeconds: remember ? Math.floor((expiresAt.getTime() - now.getTime()) / 1000) : undefined,
      }
    },
  }
}
