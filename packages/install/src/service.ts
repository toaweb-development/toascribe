// The install service: what the setup wizard's API and `toa core install` both call (PLAN «Installasjon og drift»). It owns
// the one-time setup token, the system check, the wizard's saved steps, the recovery key and the install transaction. It knows
// nothing about HTTP (a request is plain values) and imports no app code, so the api and the cli can both use it.
//
// The rules it keeps (Tor, M0.4):
// - The secrets of the site (the three database passwords, the encryption key and the signing key) live in `.env`. The wizard
//   only checks that they exist and are valid (`systemCheck`); nothing here writes them.
// - A saved step is a plain setting (`blogname`, `smtp_*`, ...), so a reload of the wizard finds its data. The administrator
//   and the default content are made only by `install`, in one transaction.
// - Every write takes the install lock (`lockInstall`) and stops when the site is installed, so a step saved a moment
//   after the install, a second install and a new token cannot change an installed site.
import { randomUUID } from 'node:crypto'

import { generateToken, constantTimeEqual, hashPassword, hashToken } from '@toascribe/auth'
import {
  getInstallState,
  getMigrationStatus,
  getSiteSecret,
  lockInstall,
  markInstalled,
  raiseAdminNotice,
  readMigrationJournal,
  resolveAdminNotice,
  seedDefaultContent,
  setSiteSecret,
  DefaultContentExistsError,
} from '@toascribe/db'
import type { Database } from '@toascribe/db'
import {
  CoreSettings,
  SMTP_PASSWORD_AAD,
  SETUP_EMAIL_SKIPPED_NOTICE,
  SetupAdmin,
  SetupEmail,
  SetupSite,
  SetupToken,
} from '@toascribe/shared'
import type {
  AuditSource,
  EmailMessage,
  KeyRing,
  SetupCheckResponse,
  SetupEmailSaved,
  SetupEmailTestResponse,
  SetupStateResponse,
  SetupStatusResponse,
  SetupStep,
  SmtpSecureMode,
} from '@toascribe/shared'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { z } from 'zod'

import { AlreadyInstalledError, InstallError } from './errors.ts'
import { observeOrigin } from './observed-origin.ts'
import type { RequestAddressHeaders } from './observed-origin.ts'
import { generateRecoveryKey, recoveryKeyVerifier, verifyRecoveryKey } from './recovery-key.ts'
import {
  findAdministratorRoleId,
  freeNicename,
  hasAdminNotice,
  insertAdministrator,
  insertAudit,
  nicenameFor,
  readSettings,
  writeSettings,
} from './repository.ts'
import type { Executor } from './repository.ts'

/** What the system check looks at in a key: both are 32 random bytes (AES-256-GCM and HMAC-SHA256). */
const KEY_BYTES = 32

/** The port a new SMTP connection uses when the wizard does not name one. The same as the worker's (`DEFAULT_PORT`). */
const DEFAULT_SMTP_PORT: Readonly<Record<SmtpSecureMode, number>> = { tls: 465, starttls: 587, none: 25 }

/** How long a «not installed» answer is remembered. «Installed» is remembered for good: it never goes back. */
const NOT_INSTALLED_CACHE_MS = 1000

/** The test mail: how long to wait for the worker, and how often to look. */
const EMAIL_TEST_TIMEOUT_MS = 30_000
const EMAIL_TEST_POLL_MS = 250
/** A test mail that no worker has picked up by now is dropped by the queue, so it cannot arrive long after the wizard gave up. */
const EMAIL_TEST_QUEUE_SECONDS = 90

/** What the service needs of the job queue to send the test mail and to see how it ended. */
export interface InstallMail {
  /** Queues the mail as a job that is tried once (`retryLimit: 0`) and dropped from the queue after `retentionSeconds`. `jobId` is null when the throttle was hit. */
  sendMail: (
    message: EmailMessage,
    options: {
      readonly throttle: { readonly key: string; readonly seconds: number }
      readonly retryLimit: 0
      readonly retentionSeconds: number
    },
  ) => Promise<{ readonly jobId: string | null }>
  /** The state of a job and what the worker stored as its output, or null when there is no such job. */
  jobState: (jobId: string) => Promise<{ readonly state: string; readonly output: unknown } | null>
}

/** The M0.3 proxy check, as the api reports it. */
export interface ProxyReport {
  readonly state: 'configured' | 'watching' | 'ok' | 'warning'
  readonly observed: number
  readonly address: string | null
}

export interface InstallServiceDeps {
  /** The app role's database. */
  readonly db: Database
  readonly keyRing: KeyRing
  /** PUBLIC_ORIGIN. The default content's links and the check of the address are made from it. */
  readonly publicOrigin: string
  readonly logger: Logger
  readonly clock?: () => Date
  /** Where the test mail goes. Without it `testEmail` answers `queue_unavailable`. */
  readonly mail?: InstallMail
  /**
   * The length of TOASCRIBE_SIGNING_KEY as it was read from the environment, for the system check. The encryption key needs
   * no such number: `createKeyRing` refuses a key that is not 32 bytes, so a ring that exists has a key of the right length.
   */
  readonly signingKeyBytes: number
  /** The M0.3 proxy check; absent where there is none (the cli). */
  readonly proxyStatus?: () => ProxyReport
  /** Tests: another journal folder, a shorter wait for the test mail. */
  readonly migrationsFolder?: string
  readonly emailTest?: { readonly timeoutMs?: number; readonly pollMs?: number }
  readonly notInstalledCacheMs?: number
}

export interface InstallInput {
  /** The first administrator. Checked again here with the rules everywhere else an account is made. */
  readonly admin: { readonly username: string; readonly email: string; readonly password: string }
  /** The «Nettstedet» step, for a caller that does not save steps one by one (the cli). It is saved in the install transaction. */
  readonly site?: SetupSite
  /**
   * The «E-post» step, for the same caller: the settings to save, `{ skip: true }` (the notice the dashboard shows), or
   * `{ fromEnvironment: true }` for a caller that leaves the mail to the SMTP defaults of the environment (`SMTP_HOST`, ...): nothing is
   * saved, no notice is raised, and the caller has checked that the defaults are there.
   */
  readonly email?: SetupEmail | { readonly skip: true } | { readonly fromEnvironment: true }
  /**
   * The recovery key the person was shown, and their statement that they saved it. Without it (the cli) a key is made here
   * and returned in the result, for the caller to show once.
   */
  readonly recovery?: { readonly key: string; readonly confirmed: true }
  /** Where the install was started from, for the audit log. Default: `setup`. */
  readonly source?: Extract<AuditSource, 'setup' | 'cli'>
  readonly context?: { readonly ip: string | null; readonly requestId?: string | undefined }
}

export interface InstallResult {
  readonly accountId: string
  readonly username: string
  readonly email: string
  /** ISO 8601 UTC. */
  readonly installedAt: string
  /** The key made by this call, when `recovery` was not given. Shown once and never stored. */
  readonly recoveryKey: string | null
  readonly defaultContent: {
    readonly categoryId: string
    readonly postId: string
    readonly commentId: string
    readonly samplePageId: string
    readonly privacyPolicyPageId: string
  }
}

export interface InstallService {
  /** True once the install transaction has committed. Cheap: «installed» is cached for good, «not installed» for a second. */
  isInstalled: () => Promise<boolean>
  /** Forgets what `isInstalled` remembered (a test that resets the database; `toa dev reset`). */
  forgetInstalled: () => void
  /** GET /setup/status: installed or not, and the first step that is not saved. */
  status: () => Promise<SetupStatusResponse>
  /** GET /setup/state: what is saved, for a reload. */
  state: () => Promise<SetupStateResponse>
  /**
   * Makes a new setup token, stores only its hash (the old token stops working) and returns the token. The caller shows it
   * once. Throws AlreadyInstalledError for an installed site.
   */
  issueSetupToken: () => Promise<string>
  /** True when `token` is the current setup token. Constant time on the hash. Never true once the site is installed. */
  verifySetupToken: (token: string) => Promise<boolean>
  systemCheck: (request: RequestAddressHeaders) => Promise<SetupCheckResponse>
  saveSite: (input: unknown) => Promise<SetupSite>
  saveEmail: (input: unknown) => Promise<SetupEmailSaved>
  /** Skips the e-mail step and stores the notice the dashboard shows (M0.5). */
  skipEmail: () => Promise<void>
  /** Sends a test mail with the saved SMTP settings and says whether the worker handed it to the SMTP server. */
  testEmail: (to: string) => Promise<SetupEmailTestResponse>
  /** Makes a recovery key, stores its verifier (replacing an earlier one) and returns the key, which is not stored. */
  generateRecoveryKey: () => Promise<string>
  install: (input: InstallInput) => Promise<InstallResult>
}

/** What the worker stores on a failed mail job (apps/worker/src/jobs/email.ts): a code, never the text of an error. */
const WorkerOutput = z.object({ error: z.enum(['send_failed', 'mail_config']) })

function textOf(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || '(input)'))]
  return `Invalid input: ${fields.join(', ')}`
}

/** Parses `input` with `schema`; a failure is an InstallError that names the fields and never shows the values (they can be passwords). */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new InstallError('invalid_input', textOf(parsed.error))
  }
  return parsed.data
}

/** The name of the unique index a statement broke (SQLSTATE 23505). Drizzle wraps the driver's error in `cause`. */
function uniqueViolation(err: unknown): string | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && current.code === '23505') {
      return 'constraint' in current && typeof current.constraint === 'string' ? current.constraint : ''
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

const SiteSettings = CoreSettings.pick({
  blogname: true,
  locale: true,
  timezone_string: true,
  admin_email: true,
  blog_public: true,
})

const EmailSettings = CoreSettings.pick({
  smtp_host: true,
  smtp_port: true,
  smtp_secure: true,
  smtp_username: true,
  smtp_password: true,
  mail_from_address: true,
  mail_from_name: true,
})

export function createInstallService(deps: InstallServiceDeps): InstallService {
  const { db, keyRing, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  const publicOrigin = new URL(deps.publicOrigin).origin
  const notInstalledCacheMs = deps.notInstalledCacheMs ?? NOT_INSTALLED_CACHE_MS

  let installedForGood = false
  let testRunning = false
  let notInstalledUntil = 0

  function rememberInstalled(): void {
    installedForGood = true
  }

  async function isInstalled(): Promise<boolean> {
    if (installedForGood) {
      return true
    }
    if (Date.now() < notInstalledUntil) {
      return false
    }
    const state = await getInstallState(db)
    if (state.installed) {
      rememberInstalled()
      return true
    }
    notInstalledUntil = Date.now() + notInstalledCacheMs
    return false
  }

  /**
   * Runs `work` in a transaction that holds the install lock, and only while the site is not installed. READ COMMITTED (the
   * default) is required: the state is read after the lock is taken.
   */
  function whileOpen<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const state = await lockInstall(tx)
      if (state.installed) {
        rememberInstalled()
        throw new AlreadyInstalledError()
      }
      return work(tx)
    })
  }

  async function nextStepOf(exec: Executor): Promise<SetupStep> {
    const { blogname, smtp_verified_at } = await readSettings(
      exec,
      CoreSettings.pick({ blogname: true, smtp_verified_at: true }),
    )
    if (blogname.trim() === '') {
      return 'check'
    }
    // Saved settings are not enough: a test mail has to have gone through with them (smtp_verified_at), or the step is skipped.
    const emailDone = smtp_verified_at !== null || (await hasAdminNotice(exec, SETUP_EMAIL_SKIPPED_NOTICE.key))
    return emailDone ? 'admin' : 'email'
  }

  async function readSite(exec: Executor): Promise<SetupSite | null> {
    const s = await readSettings(exec, SiteSettings)
    if (s.blogname.trim() === '' || s.admin_email === null) {
      return null
    }
    return {
      locale: s.locale,
      title: s.blogname,
      timezone: s.timezone_string,
      adminEmail: s.admin_email,
      blogPublic: s.blog_public,
    }
  }

  async function readEmail(exec: Executor): Promise<SetupEmailSaved | null> {
    const s = await readSettings(exec, EmailSettings)
    if (s.smtp_host === null) {
      return null
    }
    const secure = s.smtp_secure ?? 'starttls'
    return {
      host: s.smtp_host,
      port: s.smtp_port ?? DEFAULT_SMTP_PORT[secure],
      secure,
      username: s.smtp_username,
      smtpPasswordSet: s.smtp_password !== null,
      fromAddress: s.mail_from_address ?? '',
      fromName: s.mail_from_name,
    }
  }

  async function writeSite(exec: Executor, site: SetupSite): Promise<void> {
    await writeSettings(exec, [
      ['blogname', site.title],
      ['locale', site.locale],
      ['timezone_string', site.timezone],
      ['admin_email', site.adminEmail],
      ['blog_public', site.blogPublic],
    ])
  }

  /** The password to store: encrypted before the transaction starts (it is a slow, async step), `undefined` to keep what is stored. */
  async function sealPassword(email: SetupEmail): Promise<string | null | undefined> {
    if (email.username === undefined || email.username === '') {
      return null
    }
    if (email.password === undefined) {
      return undefined
    }
    return email.password === '' ? null : await keyRing.encrypt(email.password, SMTP_PASSWORD_AAD)
  }

  async function writeEmail(exec: Executor, email: SetupEmail, sealed: string | null | undefined): Promise<void> {
    const username = email.username === undefined || email.username === '' ? null : email.username
    const password =
      sealed === undefined
        ? (await readSettings(exec, CoreSettings.pick({ smtp_password: true }))).smtp_password
        : sealed
    await writeSettings(exec, [
      ['smtp_host', email.host],
      ['smtp_port', email.port ?? DEFAULT_SMTP_PORT[email.secure]],
      ['smtp_secure', email.secure],
      ['smtp_username', username],
      ['smtp_password', password],
      ['mail_from_address', email.fromAddress],
      ['mail_from_name', email.fromName === undefined || email.fromName === '' ? null : email.fromName],
      // Other settings than the ones that were tested: the earlier test no longer counts.
      ['smtp_verified_at', null],
    ])
  }

  /** Queues the test mail and waits for the job to end. */
  async function runEmailTest(mail: InstallMail, address: string): Promise<SetupEmailTestResponse> {
    const timeoutMs = deps.emailTest?.timeoutMs ?? EMAIL_TEST_TIMEOUT_MS
    const pollMs = deps.emailTest?.pollMs ?? EMAIL_TEST_POLL_MS
    const { locale } = await readSettings(db, CoreSettings.pick({ locale: true }))
    // What the worker will test: the SMTP settings as saved now. A save while the test runs makes the answer one about other settings.
    const tested = JSON.stringify(await readSettings(db, EmailSettings))

    let jobId: string | null
    try {
      ;({ jobId } = await mail.sendMail(
        {
          template: 'test',
          to: address,
          data: { requestedBy: locale === 'nb' ? 'oppsettsveiviseren' : 'the setup wizard' },
        },
        {
          // A key of its own for every test, so the queue's duplicate rule (the same message to the same address within a minute is
          // sent once) cannot swallow a second test after the person corrected the settings.
          throttle: { key: `setup.test-email.${randomUUID()}`, seconds: 1 },
          // The person is waiting for the answer. A failure is shown at once, not tried again for half an hour.
          retryLimit: 0,
          retentionSeconds: EMAIL_TEST_QUEUE_SECONDS,
        },
      ))
    } catch (err) {
      logger.warn({ err }, 'setup test mail: the job could not be queued')
      return { ok: false, error: 'queue_unavailable' }
    }
    if (jobId === null) {
      return { ok: false, error: 'queue_unavailable' }
    }

    const deadline = Date.now() + timeoutMs
    for (;;) {
      let job: Awaited<ReturnType<InstallMail['jobState']>>
      try {
        job = await mail.jobState(jobId)
      } catch (err) {
        logger.warn({ err, jobId }, 'setup test mail: the job state cannot be read')
        return { ok: false, error: 'queue_unavailable' }
      }
      if (job?.state === 'completed') {
        // The earlier skip no longer holds: the site can send mail. The e-mail step is done for these settings, and only if they are
        // still the ones that were tested. (The site may have been installed meanwhile; the answer is still true, nothing is marked.)
        try {
          await whileOpen(async (tx) => {
            if (JSON.stringify(await readSettings(tx, EmailSettings)) === tested) {
              await writeSettings(tx, [['smtp_verified_at', clock().toISOString()]])
            }
            await resolveAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE.key)
          })
        } catch (err) {
          if (!(err instanceof AlreadyInstalledError)) {
            throw err
          }
        }
        return { ok: true }
      }
      if (job === null || job.state === 'failed' || job.state === 'cancelled') {
        // Only the worker's own code is passed on, never the text of an error (it can hold an address or a user name).
        const reported = WorkerOutput.safeParse(job?.output)
        return { ok: false, error: reported.success ? reported.data.error : 'send_failed' }
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: 'timeout' }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
    }
  }

  const service: InstallService = {
    isInstalled,

    forgetInstalled() {
      installedForGood = false
      notInstalledUntil = 0
    },

    async status() {
      if (await isInstalled()) {
        return { installed: true, nextStep: null }
      }
      return { installed: false, nextStep: await nextStepOf(db) }
    },

    async state() {
      return {
        nextStep: await nextStepOf(db),
        site: await readSite(db),
        email: await readEmail(db),
        emailSkipped: await hasAdminNotice(db, SETUP_EMAIL_SKIPPED_NOTICE.key),
      }
    },

    async issueSetupToken() {
      const token = generateToken()
      // Under the install lock: a token made while an install commits would otherwise outlive the install.
      await whileOpen((tx) => setSiteSecret(tx, 'setup_token', hashToken(token)))
      return token
    },

    async verifySetupToken(token) {
      if (!SetupToken.safeParse(token).success) {
        return false
      }
      const stored = await getSiteSecret(db, 'setup_token')
      // With no token stored a comparison still runs, so the time does not say whether a token exists.
      const reference = stored?.secretHash ?? '0'.repeat(64)
      const same = constantTimeEqual(hashToken(token), reference)
      return stored !== undefined && same
    },

    async systemCheck(request) {
      let database = false
      try {
        await db.execute(sql`select 1`)
        database = true
      } catch (err) {
        logger.warn({ err }, 'system check: the database does not answer')
      }

      const journal = readMigrationJournal(deps.migrationsFolder)
      let migrations = { ok: false, applied: 0, expected: journal.length, latest: journal.at(-1)?.tag ?? '' }
      if (database) {
        try {
          const status = await getMigrationStatus(db, deps.migrationsFolder)
          migrations = {
            ok: status.upToDate,
            applied: status.applied,
            expected: status.expected,
            latest: status.latest,
          }
        } catch (err) {
          logger.warn({ err }, 'system check: the migration status cannot be read')
        }
      }

      // The ring exists only if the key was valid at start-up; this proves it still encrypts and decrypts.
      const encryptionWorks = await keyRing
        .encrypt('check', 'setup:system-check')
        .then((sealed) => keyRing.decrypt(sealed, 'setup:system-check'))
        .then((plain) => plain === 'check')
        .catch(() => false)
      const encryptionKey = {
        ok: encryptionWorks,
        version: keyRing.currentVersion,
      }
      const signingKey = { ok: deps.signingKeyBytes === KEY_BYTES }

      const seen = observeOrigin(request, publicOrigin)
      const origin = {
        ok: seen === null || seen.origin === publicOrigin,
        configured: publicOrigin,
        observed: seen?.origin ?? null,
        source: seen?.source ?? null,
      }
      const proxy = deps.proxyStatus?.() ?? { state: 'configured' as const, observed: 0, address: null }

      return {
        ok: database && migrations.ok && encryptionKey.ok && signingKey.ok && origin.ok,
        database: { ok: database },
        migrations,
        encryptionKey,
        signingKey,
        proxy,
        origin,
      }
    },

    async saveSite(input) {
      const site = parse(SetupSite, input)
      await whileOpen((tx) => writeSite(tx, site))
      return site
    },

    async saveEmail(input) {
      const email = parse(SetupEmail, input)
      const sealed = await sealPassword(email)
      return whileOpen(async (tx) => {
        await writeEmail(tx, email, sealed)
        const saved = await readEmail(tx)
        if (saved === null) {
          throw new Error('the e-mail settings were not saved')
        }
        return saved
      })
    },

    async skipEmail() {
      await whileOpen((tx) => raiseAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE))
    },

    async testEmail(to) {
      const address = parse(z.email().max(254), to)
      const mail = deps.mail
      if (mail === undefined) {
        return { ok: false, error: 'queue_unavailable' }
      }
      // One test at a time: a double click is one mail, and the second answer says a test is running. (Not a queue throttle,
      // which would also hold up the next try after a quick failure, and not the queue's own duplicate rule, which would drop a
      // second test of the same address after the settings were corrected.)
      if (testRunning) {
        return { ok: false, error: 'busy' }
      }
      testRunning = true
      try {
        return await runEmailTest(mail, address)
      } finally {
        testRunning = false
      }
    },
    async generateRecoveryKey() {
      const key = generateRecoveryKey()
      const verifier = recoveryKeyVerifier(key)
      if (verifier === undefined) {
        throw new Error('a generated recovery key must be valid')
      }
      await whileOpen((tx) => setSiteSecret(tx, 'backup_recovery_key', verifier))
      return key
    },

    async install(input) {
      const admin = parse(SetupAdmin, input.admin)
      const site = input.site === undefined ? undefined : parse(SetupSite, input.site)
      const emailInput = input.email
      const email =
        emailInput === undefined || 'skip' in emailInput || 'fromEnvironment' in emailInput
          ? undefined
          : parse(SetupEmail, emailInput)
      const skipEmail = emailInput !== undefined && 'skip' in emailInput
      const emailFromEnvironment = emailInput !== undefined && 'fromEnvironment' in emailInput
      const source = input.source ?? 'setup'

      // Slow work first, so the transaction (and the lock the other installs wait on) is short: the password hash, and the
      // encryption of the SMTP password.
      const passwordHash = await hashPassword(admin.password)
      const sealed = email === undefined ? undefined : await sealPassword(email)

      const result = await db.transaction(async (tx): Promise<InstallResult> => {
        const state = await lockInstall(tx)
        if (state.installed) {
          rememberInstalled()
          throw new AlreadyInstalledError()
        }
        const now = clock()

        if (site !== undefined) {
          await writeSite(tx, site)
        }
        if (email !== undefined) {
          await writeEmail(tx, email, sealed)
        }
        if (skipEmail) {
          await raiseAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE)
        }

        // The steps the person goes through before the last act. The api checks nothing else about them.
        const step = await nextStepOf(tx)
        if (step === 'check') {
          throw new InstallError('step_missing', 'The site step is not saved yet')
        }
        if (step === 'email' && !emailFromEnvironment) {
          throw new InstallError('step_missing', 'The e-mail step is neither tested nor skipped')
        }

        // The recovery key: the one the person was shown must be the one the server made last. Without one (the cli) a key is made now.
        let recoveryKey: string | null = null
        if (input.recovery !== undefined) {
          const staged = await getSiteSecret(tx, 'backup_recovery_key')
          if (staged === undefined || !verifyRecoveryKey(input.recovery.key, staged.secretHash)) {
            throw new InstallError('recovery_key_mismatch', 'That is not the recovery key the server made last')
          }
        } else {
          recoveryKey = generateRecoveryKey()
          const verifier = recoveryKeyVerifier(recoveryKey)
          if (verifier === undefined) {
            throw new Error('a generated recovery key must be valid')
          }
          await setSiteSecret(tx, 'backup_recovery_key', verifier)
        }

        const roleId = await findAdministratorRoleId(tx)
        if (roleId === undefined) {
          throw new Error('the administrator role is missing: run the migrations (the seed makes it)')
        }
        let accountId: string
        try {
          accountId = await insertAdministrator(tx, {
            username: admin.username,
            email: admin.email,
            nicename: await freeNicename(tx, nicenameFor(admin.username)),
            passwordHash,
            roleId,
            now,
          })
        } catch (err) {
          const constraint = uniqueViolation(err)
          if (constraint === 'uq_account_username' || constraint === 'uq_account_nicename') {
            throw new InstallError('username_taken', 'That username is taken', { cause: err })
          }
          if (constraint === 'uq_account_email') {
            throw new InstallError('email_taken', 'That e-mail address is taken', { cause: err })
          }
          throw err
        }

        const settings = await readSettings(
          tx,
          CoreSettings.pick({ locale: true, timezone_string: true, admin_email: true }),
        )
        let defaultContent: InstallResult['defaultContent']
        try {
          defaultContent = await seedDefaultContent(tx, {
            siteUrl: publicOrigin,
            adminAccountId: accountId,
            locale: settings.locale,
          })
        } catch (err) {
          if (err instanceof DefaultContentExistsError) {
            throw new InstallError('content_exists', 'The database already has some of the default content', {
              cause: err,
            })
          }
          throw err
        }

        // `admin_email` was set by the site step; a caller that skipped it gets the administrator's address, as WordPress does.
        if (settings.admin_email === null) {
          await writeSettings(tx, [['admin_email', admin.email]])
        }

        await insertAudit(tx, {
          actor: admin.username,
          accountId,
          action: 'site.installed',
          objectType: 'site',
          // What was decided, never a secret: no password, no key, no token.
          newValue: {
            locale: settings.locale,
            timezone: settings.timezone_string,
            emailConfigured: (await readEmail(tx)) !== null,
            emailSkipped: await hasAdminNotice(tx, SETUP_EMAIL_SKIPPED_NOTICE.key),
            ...(emailFromEnvironment ? { emailFromEnvironment: true } : {}),
          },
          source,
          ...(input.context?.requestId === undefined ? {} : { correlationId: input.context.requestId }),
          ip: input.context?.ip ?? null,
          at: now,
        })

        // Last, so that nothing above can commit without it: sets `installed`, `installed_at` and deletes the setup token.
        const installedAt = await markInstalled(tx, now)
        return {
          accountId,
          username: admin.username,
          email: admin.email,
          installedAt,
          recoveryKey,
          defaultContent,
        }
      })

      rememberInstalled()
      logger.info({ accountId: result.accountId, source }, 'the site is installed')
      return result
    },
  }
  return service
}
