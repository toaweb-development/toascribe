import type { Database } from '@toascribe/db'
import type { MediaStorage } from '@toascribe/media'
import type { MediaJobPort } from '../ports/media-jobs.ts'
import { createInstallService } from '@toascribe/install'
import type { InstallMail, InstallService } from '@toascribe/install'
import type { KeyRing } from '@toascribe/shared'
import type { Logger } from 'pino'

import { ACCOUNT_FLOW_MINIMUM_MS } from '../lib/timing.ts'
import type { MailPort } from '../ports/mail.ts'
import { createPublicFlows } from './account-links.ts'
import type { PublicFlows } from './account-links.ts'
import { createCoreAdminMenu } from './admin-menu.ts'
import type { AdminMenuRegistry } from './admin-menu.ts'
import { createAuthService } from './auth.ts'
import type { AuthService } from './auth.ts'
import { createContentService } from './content.ts'
import type { ContentService } from './content.ts'
import { createDashboardService } from './dashboard.ts'
import { createTermService } from './terms.ts'
import type { TermService } from './terms.ts'
import { createMediaService } from './media.ts'
import type { MediaService } from './media.ts'
import { createPublicService } from './public.ts'
import { createSettingsService } from './settings.ts'
import type { ActiveThemeSource } from './active-theme.ts'
import { createAppearanceService } from './appearance.ts'
import { createCustomizeService } from './customize.ts'
import type { CustomizeService } from './customize.ts'
import type { AppearanceService } from './appearance.ts'
import type { SettingsService } from './settings.ts'
import type { PublicService } from './public.ts'
import type { DashboardService } from './dashboard.ts'
import { createMeService } from './me.ts'
import type { MeService } from './me.ts'
import { createMfaService } from './mfa.ts'
import type { MfaService } from './mfa.ts'
import { createNoticeService } from './notices.ts'
import type { NoticeService } from './notices.ts'
import { createOwnAccountService } from './own-account.ts'
import type { OwnAccountService } from './own-account.ts'
import { createProxyCheck } from './proxy-check.ts'
import type { ProxyCheck } from './proxy-check.ts'
import { createRateLimiter } from './rate-limit.ts'
import type { RateLimiter } from './rate-limit.ts'
import { createReauthenticator } from './reauth.ts'
import { createSessionService } from './sessions.ts'
import type { SessionService } from './sessions.ts'
import { createAuditor, createSafeMail } from './support.ts'
import { createSetupGate, createSetupService } from './setup.ts'
import type { SetupService } from './setup.ts'
import { createSystemService } from './system.ts'
import type { SystemService } from './system.ts'
import type { SetupGate } from '../lib/env.ts'
import { createTotpChecker } from './totp.ts'
import { createUserService } from './users.ts'
import type { UserService } from './users.ts'

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
  /** The repo version, shown on the dashboard. */
  readonly version: string
  /** How long the flows that hide whether an account exists take at least, in milliseconds. Tests set 0; the default is ACCOUNT_FLOW_MINIMUM_MS. */
  readonly minimumResponseMs?: number
  /** TOASCRIBE_TRUSTED_PROXY as set (empty when it is not): the proxy check only warns when it is empty. */
  readonly trustedProxy?: string
  /** Told about a stored setting that failed validation, so it can be logged. */
  readonly onInvalidSetting?: (key: string) => void
  /** The media library's files (M1.2). */
  readonly storage: MediaStorage
  readonly mediaJobs: MediaJobPort
  /** UPLOAD_MAX_SIZE_MB. */
  readonly uploadCapMb: number
  /** The site's active theme (menu locations, «Tilpass»). */
  readonly activeTheme: ActiveThemeSource
}

/** Everything the routes and the later flows (MFA, lost password, registration) build on, made once at start-up. */
export interface Services {
  readonly sessions: SessionService
  readonly auth: AuthService
  readonly me: MeService
  readonly system: SystemService
  /** The admin's left menu: core's items are in it, extensions register theirs (phase 1). */
  readonly adminMenu: AdminMenuRegistry
  /** The dashboard's «I korte trekk». */
  readonly dashboard: DashboardService
  /** The dashboard's notices: stored ones and the ones worked out from the system. */
  readonly notices: NoticeService
  /** The users table and role assignment. */
  readonly users: UserService
  /** Posts and pages: the lists, the editor's saves, the status changes and the bulk actions (M1.1). */
  readonly content: ContentService
  /** Categories and tags (M1.2). */
  readonly terms: TermService
  /** The media library (M1.2). */
  readonly media: MediaService
  /** Appearance → Customize (M1.5). */
  readonly customize: CustomizeService
  /** Appearance → Menus and Global sets (M1.5). */
  readonly appearance: AppearanceService
  /** Settings → General, Writing, Reading and Privacy (M1.5). */
  readonly settings: SettingsService
  /** The public reading API of the site and its theme (M1.4). */
  readonly public: PublicService
  /** Second factor: enrolment, recovery codes, the second step of a login (K-023). */
  readonly mfa: MfaService
  /** Lost password, first password, registration (K-003, K-005). */
  readonly flows: PublicFlows
  /** Password and e-mail of the signed-in account (K-012, K-013). */
  readonly ownAccount: OwnAccountService
  /** Per IP and per account limits for login, second factor, registration and lost password (K-026, K-313). */
  readonly limiter: RateLimiter
  /** Whether the stack is told who its visitors are; read by the setup wizard and Site Health later. */
  readonly proxy: ProxyCheck
  readonly keyRing: KeyRing
  readonly mail: MailPort
  /** The install service of the setup wizard (and of `toa core install`): the setup token, the saved steps, the install. */
  readonly install: InstallService
  /** The wizard's last act: install and sign the new administrator in. */
  readonly setup: SetupService
  /** In front of every setup route: 404 once installed, the setup token otherwise. */
  readonly setupGate: SetupGate
}

/** The test mail of the wizard needs to see how its job ended; a mail port without a queue behind it cannot tell, and the check says so. */
function installMailOf(mail: MailPort): InstallMail | undefined {
  const jobState = mail.jobState?.bind(mail)
  if (jobState === undefined) {
    return undefined
  }
  return {
    sendMail: (message, options) => mail.sendMail(message, options),
    jobState,
  }
}

export function createServices(deps: ServiceDeps): Services {
  const { db, clock } = deps
  const limiter = createRateLimiter(db, clock, deps.signingKey, deps.onInvalidSetting)
  const sessions = createSessionService({ db, clock, signingKey: deps.signingKey })
  const audit = createAuditor(clock)
  const mail = createSafeMail(deps.mail, deps.logger)
  const minimumResponseMs = deps.minimumResponseMs ?? ACCOUNT_FLOW_MINIMUM_MS
  const totp = createTotpChecker({ clock, keyRing: deps.keyRing, logger: deps.logger })
  const reauth = createReauthenticator({ db, clock, limiter, audit })
  const proxy = createProxyCheck({ trustedProxy: deps.trustedProxy ?? '', logger: deps.logger, clock })
  const adminMenu = createCoreAdminMenu()
  const installMail = installMailOf(deps.mail)
  const media = createMediaService({
    db,
    clock,
    audit,
    storage: deps.storage,
    jobs: deps.mediaJobs,
    logger: deps.logger,
    uploadCapMb: deps.uploadCapMb,
    publicOrigin: deps.publicOrigin,
    ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
  })
  const content = createContentService({
    db,
    clock,
    audit,
    media,
    ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
  })
  const install = createInstallService({
    db,
    keyRing: deps.keyRing,
    publicOrigin: deps.publicOrigin,
    logger: deps.logger,
    clock,
    ...(installMail === undefined ? {} : { mail: installMail }),
    signingKeyBytes: deps.signingKey.length,
    proxyStatus: () => proxy.status(),
  })
  return {
    install,
    setup: createSetupService({ db, install, sessions, clock, logger: deps.logger }),
    setupGate: createSetupGate({ install, limiter, clock }),
    sessions,
    auth: createAuthService({ db, clock, sessions, limiter }),
    me: createMeService({ db, clock }),
    system: createSystemService({ db, clock, mail: deps.mail }),
    adminMenu,
    dashboard: createDashboardService({ db, version: deps.version, content }),
    notices: createNoticeService({
      db,
      clock,
      proxy,
      audit,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    users: createUserService({ db, clock, audit }),
    content,
    terms: createTermService({
      db,
      clock,
      audit,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    media,
    customize: createCustomizeService({
      db,
      activeTheme: deps.activeTheme,
      clock,
      audit,
      media,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    appearance: createAppearanceService({
      db,
      activeTheme: deps.activeTheme,
      clock,
      audit,
      media,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    settings: createSettingsService({
      db,
      clock,
      audit,
      mail,
      limiter,
      publicOrigin: deps.publicOrigin,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
    public: createPublicService({
      db,
      clock,
      media,
      signingKey: deps.signingKey,
      limiter,
      publicOrigin: deps.publicOrigin,
      ...(deps.onInvalidSetting === undefined ? {} : { onInvalidSetting: deps.onInvalidSetting }),
    }),
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
      mail,
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
    proxy,
    keyRing: deps.keyRing,
    mail: deps.mail,
  }
}
