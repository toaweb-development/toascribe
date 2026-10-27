// The api's services for `toa` (M1.7, K-263, K-264): `toa post|term|menu|option` call the same services, with the same validation
// and rights checks, as the HTTP routes. A command acts as a named account (`--user`, as WP-CLI) and gets exactly that account's
// capabilities; the audit log names «cli» as the actor, with that account. Imported by the cli through `@toascribe/api/cli`.
import type { Database } from '@toascribe/db'
import type { KeyRing } from '@toascribe/shared'
import { createLocalStorage } from '@toascribe/media'
import type { Logger } from 'pino'

import { createMailQueue } from './adapters/mail-queue.ts'
import { createMediaQueue } from './adapters/media-queue.ts'
import type { SessionAuth } from './lib/auth-context.ts'
import { UNKNOWN_IP } from './lib/client-ip.ts'
import { AppError } from './lib/errors.ts'
import { findAccountById, findAccountByLogin, listRoleGrants } from './repositories/accounts.ts'
import { siteThemeSource } from './services/active-theme.ts'
import type { ActiveThemeSource } from './services/active-theme.ts'
import type { EmbedFetch } from './services/embeds.ts'
import { createServices } from './services/index.ts'
import type { Services } from './services/index.ts'
import { createPreviewLimit } from './services/preview-limit.ts'
import type { RequestContext } from './services/support.ts'

export { AppError } from './lib/errors.ts'
export type { Services } from './services/index.ts'
export type { SessionAuth } from './lib/auth-context.ts'
export type { RequestContext } from './services/support.ts'
export type { ActiveThemeSource } from './services/active-theme.ts'
export type { EmbedFetch } from './services/embeds.ts'

export interface CliServicesOptions {
  readonly db: Database
  /** DATABASE_URL (the app role): the mail and media queues. */
  readonly databaseUrl: string
  readonly logger: Logger
  readonly keyRing: KeyRing
  readonly publicOrigin: string
  readonly version: string
  readonly uploadsDir: string
  readonly uploadCapMb?: number
  /** Default: the site at SITE_URL_INTERNAL (menu locations); a test passes its own. */
  readonly activeTheme?: ActiveThemeSource
  readonly siteUrlInternal?: string
  /** Default: safeFetch, as the api. */
  readonly embedFetch?: EmbedFetch
}

export class UnknownActorError extends Error {
  constructor() {
    super('No active account has that username or e-mail address.')
    this.name = 'UnknownActorError'
  }
}

export interface CliServices {
  readonly services: Services
  /** The rights of an active account, as a session would have them (no CSRF: nothing in a terminal can be forged). */
  actAs(login: string): Promise<SessionAuth>
  /** The request context of a command: no address, no request id. */
  readonly context: RequestContext
  close(): Promise<void>
}

export function openCliServices(options: CliServicesOptions): CliServices {
  const mail = createMailQueue({
    connectionString: options.databaseUrl,
    keyRing: options.keyRing,
    logger: options.logger,
  })
  const media = createMediaQueue({ connectionString: options.databaseUrl, logger: options.logger })
  const previewLimit = createPreviewLimit(undefined, () => undefined)
  const services = createServices({
    db: options.db,
    clock: () => new Date(),
    // CSRF tokens are never made or checked here; the key only satisfies the type.
    signingKey: new Uint8Array(32),
    keyRing: options.keyRing,
    mail,
    logger: options.logger,
    publicOrigin: new URL(options.publicOrigin).origin,
    version: options.version,
    storage: createLocalStorage(options.uploadsDir),
    mediaJobs: media,
    uploadCapMb: options.uploadCapMb ?? 64,
    ...(options.embedFetch === undefined ? {} : { embedFetch: options.embedFetch }),
    previewLimit,
    activeTheme: options.activeTheme ?? siteThemeSource({ siteUrl: options.siteUrlInternal ?? 'http://site:3000' }),
    auditSource: 'cli',
    minimumResponseMs: 0,
    onInvalidSetting: (key) => {
      options.logger.warn({ key }, 'a stored setting is invalid; the default is used')
    },
  })
  return {
    services,
    context: { ip: UNKNOWN_IP, requestId: undefined },
    async actAs(login) {
      const account = await findAccountByLogin(options.db, login)
      if (account?.status !== 'active') throw new UnknownActorError()
      const grants = await listRoleGrants(options.db, account.id)
      const now = new Date()
      const view = await findAccountById(options.db, account.id)
      if (view === undefined) throw new UnknownActorError()
      return {
        kind: 'session',
        account: view,
        roles: grants.map((grant) => grant.slug),
        capabilities: new Set(grants.flatMap((grant) => grant.capabilities)),
        session: {
          id: '00000000-0000-0000-0000-000000000000',
          accountId: account.id,
          ip: null,
          userAgent: 'toa',
          expiresAt: now,
          lastSeenAt: now,
          createdAt: now,
          mfaVerifiedAt: now,
          isRemembered: false,
        },
        mfa: 'ok',
        via: 'app_password',
      }
    },
    async close() {
      await Promise.allSettled([mail.stop(), media.stop(), previewLimit.close()])
    },
  }
}

/** An AppError as the CLI shows it: its status says whether the input was refused (4xx: exit 2) or the run failed. */
export function isInputError(error: unknown): error is AppError {
  return error instanceof AppError && error.status >= 400 && error.status < 500 && error.status !== 409
}
