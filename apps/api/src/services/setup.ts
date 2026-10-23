// The setup wizard's side of the install (M0.4): the gate in front of its routes, the one-time setup token announced at
// start-up, and the last act, which installs the site and signs the new administrator in. The steps themselves are in
// @toascribe/install, which `toa core install` uses too; this file adds only what is the api's own (the rate limit, the
// session, the HTTP-facing errors).
import type { InstallService } from '@toascribe/install'
import type { LoginResponse, SetupInstallRequest } from '@toascribe/shared'
import type { Database } from '@toascribe/db'
import type { Logger } from 'pino'

import type { SetupGate } from '../lib/env.ts'
import { NotFoundError, UnauthorizedError } from '../lib/errors.ts'
import { findAccountById, listRoleGrants } from '../repositories/accounts.ts'
import { inTransaction } from '../repositories/executor.ts'
import type { RateLimiter } from './rate-limit.ts'
import type { IssuedSession, SessionService } from './sessions.ts'
import { assertNotDelayed, createAuditor, shownIp } from './support.ts'
import type { RequestContext } from './support.ts'

/** Where the wizard lives. A fixed path, as the admin app's base URL is (M0.4): the Caddyfile routes it. */
export const SETUP_PATH = '/admin/setup'

/** Where a new administrator lands after the install. */
const AFTER_INSTALL_PATH = '/admin'

export function createSetupGate(options: {
  readonly install: InstallService
  readonly limiter: RateLimiter
  readonly clock: () => Date
}): SetupGate {
  const { install, limiter, clock } = options
  return {
    async assertOpen() {
      if (await install.isInstalled()) {
        throw new NotFoundError()
      }
    },

    async authorize({ token, ip }) {
      if (token === undefined || token === '') {
        throw new UnauthorizedError('The setup token is required', 'setup_token_required')
      }
      // Counts the guess before it is judged (as a login is), per address: twenty wrong tokens in a row from one address and the
      // next has to wait, however many are tried in parallel. A right token marks its attempt as a success, which the address
      // counter ignores, so the wizard's own requests never use up the allowance.
      const attempt = await limiter.begin('setup', { ip })
      assertNotDelayed(attempt.status, clock())
      if (!(await install.verifySetupToken(token))) {
        throw new UnauthorizedError('The setup token is not valid', 'invalid_setup_token')
      }
      await limiter.succeed(attempt)
    },
  }
}

/** The result of the last act: the site is installed, and the administrator is signed in unless the session could not be made. */
export interface SetupInstalled {
  /** The body of the response, as after a login. Null when the session could not be made after the commit. */
  readonly login: LoginResponse | null
  /** The session whose token goes in the cookie. */
  readonly issued: IssuedSession | null
}

export interface SetupService {
  /**
   * Installs the site (the install transaction, in @toascribe/install) and signs the first administrator in, in a session
   * like the one a login makes. The sign-in happens after the commit: if it fails, the site is installed all the same, and
   * the person signs in at /admin/login.
   */
  install: (
    body: SetupInstallRequest,
    context: RequestContext & { readonly userAgent: string | null },
  ) => Promise<SetupInstalled>
}

export function createSetupService(options: {
  readonly db: Database
  readonly install: InstallService
  readonly sessions: SessionService
  readonly clock: () => Date
  readonly logger: Logger
}): SetupService {
  const { db, install, sessions, clock, logger } = options
  const audit = createAuditor(clock)

  return {
    async install(body, context) {
      const result = await install.install({
        admin: body.admin,
        recovery: { key: body.recoveryKey, confirmed: body.confirmed },
        source: 'setup',
        context: { ip: shownIp(context.ip), requestId: context.requestId },
      })

      try {
        const account = await findAccountById(db, result.accountId)
        if (account === undefined) {
          throw new Error('the new administrator was not found after the install')
        }
        const signedIn = await inTransaction(db, async (tx) => {
          const issued = await sessions.issue(
            { account, remember: false, ip: shownIp(context.ip), userAgent: context.userAgent },
            tx,
          )
          const grants = await listRoleGrants(tx, account.id)
          await audit(tx, context, {
            actor: { id: account.id, username: account.username },
            action: issued.mfa === 'ok' ? 'login.succeeded' : 'login.password_accepted',
            objectType: 'session',
            objectId: issued.session.id,
            newValue: { remember: false, mfa: issued.mfa, via: 'setup' },
          })
          return { issued, grants }
        })
        const { issued, grants } = signedIn
        const csrfToken = sessions.csrfToken(issued.session.id)
        const expiresAt = issued.session.expiresAt.toISOString()
        if (issued.mfa === 'ok') {
          return {
            issued,
            login: {
              status: 'authenticated',
              csrfToken,
              account: {
                id: account.id,
                username: account.username,
                email: account.email,
                displayName: account.displayName,
                locale: account.locale,
                roles: grants.map((grant) => grant.slug),
                capabilities: [...new Set(grants.flatMap((grant) => grant.capabilities))].sort(),
              },
              expiresAt,
              redirectTo: AFTER_INSTALL_PATH,
            },
          }
        }
        return {
          issued,
          login: { status: 'mfa_required', mfa: issued.mfa, csrfToken, expiresAt, redirectTo: AFTER_INSTALL_PATH },
        }
      } catch (err) {
        logger.error({ err }, 'the site is installed, but the administrator could not be signed in')
        return { login: null, issued: null }
      }
    },
  }
}

/**
 * Makes the setup token for a site that is not installed and writes it to the log, once, at `warn`. Returns the token (a test
 * reads it from here), or undefined for an installed site, which gets none.
 *
 * THE ONE PLACE A TOKEN IS LOGGED. Everywhere else a token, a password or a key stays out of every log (security §8). This
 * one is meant to be read: it is how the person who started the stack gets into the wizard, and it is the only thing that
 * does (the other ways, `toa core setup-token` in the container or `docker compose logs api`, need the same access to the
 * server). It works exactly once for exactly one purpose: it opens the setup routes, it is replaced by the next start or the
 * next `toa core setup-token`, and the install deletes it. The line carries it once, inside the address to open; the
 * field list stays free of it so no log processor picks it up a second time.
 */
export async function announceSetupToken(options: {
  readonly install: InstallService
  readonly logger: Logger
  readonly publicOrigin: string
}): Promise<string | undefined> {
  const { install, logger, publicOrigin } = options
  if (await install.isInstalled()) {
    return undefined
  }
  const token = await install.issueSetupToken()
  const url = new URL(SETUP_PATH, publicOrigin)
  url.searchParams.set('token', token)
  logger.warn(
    `The site is not installed yet. Open ${url.toString()} to set it up. This setup token is shown only now; ` +
      'a new one is made at the next start, or with `toa core setup-token`.',
  )
  return token
}
