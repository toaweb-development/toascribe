// Application passwords (K-016), as WordPress': a generated password per client, with a name, shown once and kept only as its hash.
// They sign in to the API with `Authorization: Basic base64(username:password)` and nothing else:
//   - only over HTTPS (the proxy says so in X-Forwarded-Proto); over plain HTTP the header is refused before it is looked at;
//   - never for the admin: the account, session and setup routes (`/auth`, `/me`, `/setup`, `/admin`) ignore the header, and the
//     login form takes only the account's own password;
//   - no CSRF token is needed (a browser never sends the header by itself: the api never answers `WWW-Authenticate`, so no
//     browser caches it, and a page on another site cannot set it without a preflight the api never allows), and the cookie
//     session keeps all its checks;
//   - a wrong password counts as a failed login for the address and the name, and a revoked password stops at once (nothing is
//     cached).
import { randomInt } from 'node:crypto'

import { constantTimeEqual, hashToken } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import type {
  AppPasswordItem,
  AppPasswordListResponse,
  CreateAppPasswordRequest,
  CreateAppPasswordResponse,
} from '@toascribe/shared'
import type { Logger } from 'pino'

import { ANONYMOUS } from '../lib/auth-context.ts'
import type { AuthContext, SessionAuth } from '../lib/auth-context.ts'
import { UNKNOWN_IP } from '../lib/client-ip.ts'
import { uniqueViolation } from '../lib/db-errors.ts'
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { findAccountByLogin, findAccountById, listRoleGrants } from '../repositories/accounts.ts'
import {
  countAppPasswords,
  deleteAppPassword,
  insertAppPassword,
  listAppPasswords,
  touchAppPassword,
} from '../repositories/app-passwords.ts'
import type { AppPasswordRow } from '../repositories/app-passwords.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { RateLimiter } from './rate-limit.ts'
import { assertNotDelayed, shownIp } from './support.ts'
import type { Auditor, RequestContext } from './support.ts'

/** At most this many per account (a client each; WordPress has no limit, a list of thousands helps nobody). */

/**
 * Capabilities an application password never carries, whatever the account's roles (M1.8 security review): raw HTML and unchecked
 * uploads stay with a signed-in person (cookie session, second factor).
 */
export const APP_PASSWORD_WITHHELD: readonly string[] = ['unfiltered_html', 'unfiltered_upload']

export const MAX_APP_PASSWORDS = 50
/** The last use is written at most this often. */
const TOUCH_EVERY_MS = 60_000
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const LENGTH = 24

/** 24 letters and digits (~143 bits), shown in groups of four as WordPress does: `abcd efgh ijkl mnop qrst uvwx`. */
export function generateAppPassword(): string {
  const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)] ?? 'a')
  return chars.join('').replace(/(.{4})(?=.)/g, '$1 ')
}

/** What is hashed: the password without its spaces (a client may send it with or without them). */
function normalized(password: string): string {
  return password.replace(/\s+/g, '')
}

/** The paths that never take an application password: the account, its sessions, the setup and the admin's own routes. */
const SESSION_ONLY = ['/api/v1/auth', '/api/v1/me', '/api/v1/setup', '/api/v1/admin']

export function takesAppPassword(path: string): boolean {
  return !SESSION_ONLY.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/** The credentials of an `Authorization: Basic …` header, or undefined when there is none (or it is not Basic). */
export function parseBasic(header: string | undefined): { login: string; password: string } | undefined {
  if (header === undefined) return undefined
  const match = /^Basic\s+([A-Za-z0-9+/=]{1,2000})\s*$/i.exec(header)
  if (match?.[1] === undefined) return { login: '', password: '' }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon < 1
    ? { login: '', password: '' }
    : { login: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

export function hasBasicHeader(header: string | undefined): boolean {
  return header !== undefined && /^Basic\s/i.test(header)
}

export class InsecureTransportError extends AppError {
  constructor() {
    super(403, 'https_required', 'Application passwords work only over HTTPS')
  }
}

export interface AppPasswordService {
  list(auth: SessionAuth): Promise<AppPasswordListResponse>
  create(auth: SessionAuth, request: CreateAppPasswordRequest, ctx: RequestContext): Promise<CreateAppPasswordResponse>
  revoke(auth: SessionAuth, id: string, ctx: RequestContext): Promise<void>
  /**
   * Who an `Authorization: Basic` header names. Anonymous for a request that is not HTTPS-forwarded is never reached: the
   * caller checks the transport first. Throws 401 for wrong credentials and 429 while the address or the name must wait.
   */
  authenticate(
    credentials: { login: string; password: string },
    request: { ip: string },
    logger: Logger,
  ): Promise<AuthContext>
}

function itemOf(row: AppPasswordRow): AppPasswordItem {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: row.lastUsedIp,
  }
}

export function createAppPasswordService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly limiter: Pick<RateLimiter, 'check' | 'begin'>
}): AppPasswordService {
  const { db, clock, audit, limiter } = options

  function cookieOnly(auth: SessionAuth): void {
    // Making or revoking one needs the person at the admin, not a client holding another application password.
    if (auth.via !== 'cookie') throw new ForbiddenError()
  }

  return {
    async list(auth) {
      return { items: (await listAppPasswords(db, auth.account.id)).map(itemOf) }
    },

    async create(auth, request, ctx) {
      cookieOnly(auth)
      const password = generateAppPassword()
      try {
        const row = await inTransaction(db, async (tx) => {
          if ((await countAppPasswords(tx, auth.account.id)) >= MAX_APP_PASSWORDS) {
            throw new AppError(
              409,
              'too_many',
              `An account has at most ${String(MAX_APP_PASSWORDS)} application passwords`,
            )
          }
          const inserted = await insertAppPassword(tx, {
            accountId: auth.account.id,
            name: request.name,
            passwordHash: hashToken(normalized(password)),
            now: clock(),
          })
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'app_password.created',
            objectType: 'app_password',
            objectId: inserted.id,
            newValue: { name: request.name },
          })
          return inserted
        })
        return { item: itemOf(row), password }
      } catch (err) {
        if (uniqueViolation(err) !== undefined)
          throw new AppError(409, 'name_taken', 'An application password has this name')
        throw err
      }
    },

    async revoke(auth, id, ctx) {
      cookieOnly(auth)
      await inTransaction(db, async (tx) => {
        if (!(await deleteAppPassword(tx, auth.account.id, id))) throw new NotFoundError()
        await audit(tx, ctx, {
          actor: { id: auth.account.id, username: auth.account.username },
          action: 'app_password.revoked',
          objectType: 'app_password',
          objectId: id,
        })
      })
    },

    async authenticate(credentials, request, logger) {
      const now = clock()
      const account = credentials.login === '' ? undefined : await findAccountByLogin(db, credentials.login)
      // Counted by the address only (M1.8 review): guessing 143 random bits is hopeless, so a wait on the account would only let
      // anyone who knows the name block the account's API clients with wrong logins, and a stale password in a script would keep
      // slowing its owner's own login. An address that keeps failing still waits, as at the login form.
      const subject = { ip: request.ip }
      assertNotDelayed(await limiter.check('login', subject), now)
      const presented = hashToken(normalized(credentials.password))
      const match =
        account?.status === 'active'
          ? (await listAppPasswords(db, account.id)).find((row) => constantTimeEqual(row.passwordHash, presented))
          : undefined
      if (account === undefined || match === undefined) {
        // Counted as a failed login: the same limits and waits as the login form.
        await limiter.begin('login', subject)
        logger.warn({ accountId: account?.id ?? null }, 'application password refused')
        throw new UnauthorizedError('The username or the application password is wrong', 'invalid_app_password')
      }
      await touchAppPassword(
        db,
        match.id,
        now,
        request.ip === UNKNOWN_IP ? null : shownIp(request.ip),
        new Date(now.getTime() - TOUCH_EVERY_MS),
      )
      const view = await findAccountById(db, account.id)
      if (view === undefined) return ANONYMOUS
      const grants = await listRoleGrants(db, account.id)
      return {
        kind: 'session',
        account: view,
        roles: grants.map((grant) => grant.slug),
        // Without raw HTML: an application password cannot write markup or «Ekstra CSS» that runs with the page's rights on the
        // site, where a signed-in administrator's cookie would carry it to the user routes the password itself may not use.
        capabilities: new Set(
          grants
            .flatMap((grant) => grant.capabilities)
            .filter((capability) => !APP_PASSWORD_WITHHELD.includes(capability)),
        ),
        // Not a session: the password's own id stands in for one, so nothing that lists sessions mistakes it for one.
        session: {
          id: match.id,
          accountId: account.id,
          ip: null,
          userAgent: null,
          expiresAt: now,
          lastSeenAt: now,
          createdAt: match.createdAt,
          mfaVerifiedAt: now,
          isRemembered: false,
        },
        mfa: 'ok',
        via: 'app_password',
      }
    },
  }
}
