// `toa core install`, `is-installed`, `gen-env` and `setup-token`: the command-line side of the setup wizard (M0.4). `install`
// calls the install service that the wizard's API calls (packages/install), so a site installed here is the same site: the
// administrator, the default content and the settings in one transaction, and the `installed` flag last. They run in the api
// container as the app role (DATABASE_URL); `gen-env` needs no database and no environment at all, because it runs before
// the first `docker compose up` (when compose has nothing to start the api with).
//
// What is printed where: the result of a command (the recovery key, a generated password, a token) goes to stdout, the
// sentences to stderr, and the log goes to stderr. No secret is ever written to stderr or to the log. The recovery key and the
// generated password are shown once and kept nowhere.
import { randomBytes } from 'node:crypto'

import { getInstallState } from '@toascribe/db'
import { AlreadyInstalledError, InstallError, createInstallService } from '@toascribe/install'
import type { InstallService } from '@toascribe/install'
import { SetupAdmin, SetupSite } from '@toascribe/shared'
import type { KeyRing } from '@toascribe/shared'
import type { Logger } from 'pino'
import { z } from 'zod'

import { namesSet, loadSiteDatabaseConfig } from '../config.ts'
import type { SiteDatabaseConfig } from '../config.ts'
import {
  OBVIOUS_PASSWORD,
  UsageError,
  checked,
  choosePassword,
  isCliResult,
  isTooObvious,
  parseFlags,
  refusal,
  usageResult,
  withConfiguredDatabase,
  withDatabase,
} from '../kit.ts'
import type { ChosenPassword } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import { createTerminalPrompter } from '../prompt.ts'
import type { Prompter } from '../prompt.ts'
import type { CliResult } from '../result.ts'
import { readProcessStdin } from '../stdin.ts'
import { CORE_GEN_ENV_USAGE, CORE_INSTALL_USAGE, CORE_IS_INSTALLED_USAGE, CORE_SETUP_TOKEN_USAGE } from '../usage.ts'

/** The default language and time zone of a new site (PLAN: nb, Europe/Oslo). */
const DEFAULT_LOCALE = 'nb'
const DEFAULT_TIMEZONE = 'Europe/Oslo'

/** The service is used for what needs no key: the encryption key is read only by the commands that queue a mail with a link. */
const NO_KEY_RING: KeyRing = {
  currentVersion: 0,
  versions: [],
  encrypt: () => Promise.reject(new Error('this command has no encryption key')),
  decrypt: () => Promise.reject(new Error('this command has no encryption key')),
}

function installService(
  db: Parameters<typeof createInstallService>[0]['db'],
  config: SiteDatabaseConfig,
  logger: Logger,
): InstallService {
  // No system check here (that is the wizard's), so no signing key is looked at either.
  return createInstallService({
    db,
    keyRing: NO_KEY_RING,
    publicOrigin: config.PUBLIC_ORIGIN,
    logger,
    signingKeyBytes: 0,
  })
}

/** Commands that take no arguments at all. */
function noArguments(args: readonly string[], usage: string): CliResult | undefined {
  return args.length === 0 ? undefined : usageResult('This command takes no arguments.', usage)
}

// ── gen-env ────────────────────────────────────────────────

/** The five values docker/.env needs from the owner (docker/.env.example), in the order they are printed. */
export const GEN_ENV_NAMES = [
  'POSTGRES_PASSWORD',
  'POSTGRES_OWNER_PASSWORD',
  'POSTGRES_APP_PASSWORD',
  'TOASCRIBE_ENCRYPTION_KEY',
  'TOASCRIBE_SIGNING_KEY',
] as const

/** 32 random bytes as 64 hex characters: a key for the ring, and a password with no character a database URL must escape. */
const SECRET_BYTES = 32

/**
 * `toa core gen-env`: five new values as `.env` lines. It only prints; the owner appends it to `docker/.env`. It reads no
 * configuration and opens no connection, so it runs before there is a database, an env file or a working api. Distinct values
 * are guaranteed (the api refuses a signing key equal to the encryption key), not left to chance.
 */
export function coreGenEnv(args: readonly string[], options: CommandOptions = {}): CliResult {
  const extra = noArguments(args, CORE_GEN_ENV_USAGE)
  if (extra !== undefined) {
    return extra
  }
  const values = new Set<string>()
  while (values.size < GEN_ENV_NAMES.length) {
    values.add(randomBytes(SECRET_BYTES).toString('hex'))
  }
  const lines = GEN_ENV_NAMES.map((name, index) => `${name}=${[...values][index] ?? ''}\n`)
  const present = namesSet(GEN_ENV_NAMES, options.env)
  return {
    code: 0,
    stdout: lines.join(''),
    stderr:
      present.length === 0
        ? ''
        : `Warning: ${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} already set in the environment. ` +
          'Appending these lines to docker/.env would repeat the key; a database password or key that is already in use must not be replaced this way.\n',
  }
}

// ── is-installed ───────────────────────────────────────────

/** `toa core is-installed`: exit 0 installed, 1 not installed, 2 for an error. Prints nothing, as `wp core is-installed`. */
export async function coreIsInstalled(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const extra = noArguments(args, CORE_IS_INSTALLED_USAGE)
  if (extra !== undefined) {
    return extra
  }
  const outcome = await withDatabase(options, 'core is-installed', async (db) => (await getInstallState(db)).installed)
  if (isCliResult(outcome)) {
    // A bad environment, a database that does not answer, tables that are not there: not «not installed», so not 1.
    return { ...outcome, code: 2 }
  }
  return { code: outcome ? 0 : 1, stdout: '', stderr: '' }
}

// ── setup-token ────────────────────────────────────────────

/** Where the wizard is, relative to the site's address. A fixed path (M0.4). */
const SETUP_PATH = '/admin/setup'

/** `toa core setup-token`: a new one-time token (the old one stops working), for the wizard of a site that is not installed. */
export async function coreSetupToken(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const extra = noArguments(args, CORE_SETUP_TOKEN_USAGE)
  if (extra !== undefined) {
    return extra
  }
  const outcome = await withConfiguredDatabase(
    options,
    'core setup-token',
    loadSiteDatabaseConfig,
    async (db, logger, config) => {
      try {
        const token = await installService(db, config, logger).issueSetupToken()
        return { token, url: `${new URL(config.PUBLIC_ORIGIN).origin}${SETUP_PATH}?token=${encodeURIComponent(token)}` }
      } catch (err) {
        if (err instanceof AlreadyInstalledError) {
          return refusal('The site is already installed, so there is no setup token to make.')
        }
        throw err
      }
    },
  )
  if (isCliResult(outcome)) {
    return outcome
  }
  return {
    code: 0,
    stdout: `Setup token: ${outcome.token}\nSetup address: ${outcome.url}\n`,
    stderr: 'The token is shown once and the earlier one no longer works. It ends when the site is installed.\n',
  }
}

// ── install ────────────────────────────────────────────────

const INSTALL_FLAGS = {
  url: 'string',
  title: 'string',
  locale: 'string',
  timezone: 'string',
  'admin-user': 'string',
  'admin-email': 'string',
  'admin-password-stdin': 'boolean',
  'skip-email': 'boolean',
  'no-index': 'boolean',
} as const

/** Flags that have no default, so a run without them asks (in a terminal) or is refused. */
const REQUIRED_INSTALL_FLAGS = ['url', 'title', 'admin-user', 'admin-email'] as const

/** The origin of an address that is scheme and host (and port) only: no path, query, fragment or login. */
function siteOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
      return undefined
    }
    if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

/** The address of the site as its origin, `https://example.com`: what is compared with PUBLIC_ORIGIN. */
const SiteAddress = z.string().transform((value, ctx) => {
  const origin = siteOrigin(value.trim())
  if (origin === undefined) {
    ctx.issues.push({
      code: 'custom',
      message: 'Must be the address of the site as https://example.com, without a path',
      input: '',
    })
    return z.NEVER
  }
  return origin
})

const Title = SetupSite.shape.title
const Locale = SetupSite.shape.locale
const Timezone = SetupSite.shape.timezone
const AdminUser = SetupAdmin.shape.username
const AdminEmail = SetupAdmin.shape.email

/** What the person has said about the site and its administrator. The password is separate. */
interface InstallAnswers {
  readonly url: string
  readonly title: string
  readonly locale: string
  readonly timezone: string
  readonly adminUser: string
  readonly adminEmail: string
  readonly noIndex: boolean
  readonly skipEmail: boolean
}

/** The flags as they were given, already checked. */
interface GivenAnswers {
  readonly url?: string
  readonly title?: string
  readonly locale?: string
  readonly timezone?: string
  readonly adminUser?: string
  readonly adminEmail?: string
  readonly noIndex: boolean
  readonly skipEmail: boolean
  /** The flags that were left out and have no default: the questions of an interactive run. */
  readonly missing: readonly string[]
  /** The password from standard input, if `--admin-password-stdin` was given. */
  readonly password?: string
}

/** Asks until the answer passes `schema`, five tries; the empty answer is `fallback` if there is one. */
async function askValid<T>(prompt: Prompter, question: string, schema: z.ZodType<T>, fallback?: string): Promise<T> {
  let last = 'no answer'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = (await prompt.ask(`${question}${fallback === undefined ? '' : ` [${fallback}]`}: `)).trim()
    const parsed = schema.safeParse(answer === '' && fallback !== undefined ? fallback : answer)
    if (parsed.success) {
      return parsed.data
    }
    last = parsed.error.issues[0]?.message ?? 'invalid'
    prompt.say(`  ${last}`)
  }
  throw new UsageError(`${question}: ${last}`)
}

async function askYesNo(prompt: Prompter, question: string, fallback: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = (await prompt.ask(`${question} [${fallback ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase()
    if (answer === '') {
      return fallback
    }
    if (['y', 'yes', 'j', 'ja'].includes(answer)) {
      return true
    }
    if (['n', 'no', 'nei'].includes(answer)) {
      return false
    }
  }
  throw new UsageError(`${question}: answer y or n`)
}

/** The password asked for twice, hidden; empty means «make a strong one». */
async function askPassword(prompt: Prompter): Promise<string | undefined> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const first = await prompt.ask('Administrator password (empty: make a strong one): ', { secret: true })
    if (first === '') {
      return undefined
    }
    const again = await prompt.ask('Repeat the password: ', { secret: true })
    if (first === again) {
      return first
    }
    prompt.say('  The two passwords differ.')
  }
  throw new UsageError('The two passwords did not match.')
}

/** Reads and checks the flags of `core install` (and the password on standard input). Throws UsageError. */
async function readInstallFlags(
  args: readonly string[],
  prompt: Prompter,
  options: CommandOptions,
): Promise<GivenAnswers> {
  const flags = parseFlags(args, INSTALL_FLAGS)
  const problems: string[] = []
  const url = flags['url'] === undefined ? undefined : checked('url', SiteAddress, flags['url'], problems)
  const title = flags['title'] === undefined ? undefined : checked('title', Title, flags['title'], problems)
  const locale = flags['locale'] === undefined ? undefined : checked('locale', Locale, flags['locale'], problems)
  const timezone =
    flags['timezone'] === undefined ? undefined : checked('timezone', Timezone, flags['timezone'], problems)
  const adminUser =
    flags['admin-user'] === undefined ? undefined : checked('admin-user', AdminUser, flags['admin-user'], problems)
  const adminEmail =
    flags['admin-email'] === undefined ? undefined : checked('admin-email', AdminEmail, flags['admin-email'], problems)
  if (problems.length > 0) {
    throw new UsageError(problems.join('\n'))
  }
  const missing = REQUIRED_INSTALL_FLAGS.filter((flag) => flags[flag] === undefined).map((flag) => `--${flag}`)
  let password: string | undefined
  if (flags['admin-password-stdin'] === true) {
    // Standard input is the password or the keyboard, not both: with --admin-password-stdin nothing is asked.
    if (missing.length > 0) {
      throw new UsageError(
        `With --admin-password-stdin nothing is asked, so these are required: ${missing.join(', ')}.`,
      )
    }
    password = (await choosePassword(true, options.readStdin ?? readProcessStdin)).password
  } else if (missing.length > 0 && !prompt.interactive) {
    throw new UsageError(
      `These are required unless the command is run in a terminal, where it asks: ${missing.join(', ')}.`,
    )
  }
  return {
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
    ...(locale === undefined ? {} : { locale }),
    ...(timezone === undefined ? {} : { timezone }),
    ...(adminUser === undefined ? {} : { adminUser }),
    ...(adminEmail === undefined ? {} : { adminEmail }),
    ...(password === undefined ? {} : { password }),
    noIndex: flags['no-index'] === true,
    skipEmail: flags['skip-email'] === true,
    missing,
  }
}

/** Asks for what the flags left out (a terminal only: `readInstallFlags` has refused otherwise). */
async function askInstallAnswers(
  given: GivenAnswers,
  prompt: Prompter,
  config: SiteDatabaseConfig,
  smtpReady: boolean,
): Promise<InstallAnswers & { readonly password: string | undefined }> {
  const asking = given.missing.length > 0
  const origin = new URL(config.PUBLIC_ORIGIN).origin
  const url = given.url ?? (await askValid(prompt, 'Site address (PUBLIC_ORIGIN)', SiteAddress, origin))
  const title = given.title ?? (await askValid(prompt, 'Site title', Title))
  const locale = given.locale ?? (asking ? await askValid(prompt, 'Language', Locale, DEFAULT_LOCALE) : DEFAULT_LOCALE)
  const timezone =
    given.timezone ?? (asking ? await askValid(prompt, 'Time zone', Timezone, DEFAULT_TIMEZONE) : DEFAULT_TIMEZONE)
  const adminUser = given.adminUser ?? (await askValid(prompt, 'Administrator username', AdminUser))
  const adminEmail = given.adminEmail ?? (await askValid(prompt, 'Administrator e-mail address', AdminEmail))
  const noIndex =
    given.noIndex || (asking && (await askYesNo(prompt, 'Ask search engines not to index the site?', false)))
  let skipEmail = given.skipEmail
  if (asking && !skipEmail) {
    skipEmail = smtpReady
      ? !(await askYesNo(prompt, 'Use the SMTP settings of the environment for e-mail?', true))
      : await askYesNo(prompt, 'SMTP_HOST and MAIL_FROM_ADDRESS are not set. Install without e-mail?', true)
  }
  const password = given.password ?? (asking ? await askPassword(prompt) : undefined)
  return { url, title, locale, timezone, adminUser, adminEmail, noIndex, skipEmail, password }
}

/** What an InstallError means to the person at the command line. */
function installRefusal(err: InstallError): CliResult {
  switch (err.code) {
    case 'username_taken':
      return refusal('--admin-user: an account already has that username (case is ignored). Nothing was changed.')
    case 'email_taken':
      return refusal(
        '--admin-email: an account already has that e-mail address (case is ignored). Nothing was changed.',
      )
    case 'content_exists':
      return refusal(
        'The database already has some of the default content (a post or page with the same address). Nothing was changed.',
      )
    case 'invalid_input':
      return { code: 2, stdout: '', stderr: `${err.message}\n` }
    case 'step_missing':
    case 'recovery_key_mismatch':
      // Not reachable from here (the cli gives the service every step and no key); say so rather than guess.
      return refusal(`The install could not be completed (${err.code}). Nothing was changed.`)
  }
}

/**
 * `toa core install`: installs the site through the same service as the wizard. Fully non-interactive when `--url`, `--title`,
 * `--admin-user` and `--admin-email` are given; otherwise it asks, in a terminal only (anywhere else it is refused with the usage).
 *
 * The decisions:
 * - `--url` is not a second site address. It must be the origin in PUBLIC_ORIGIN: the api's cookies, Origin checks, the links in
 *   mails and the default content are all made from that one, so another value would install a site that its own api refuses.
 *   A different value is refused with the one to use. The flag lets a script state which site it believes it is installing.
 * - E-mail: without `--skip-email` the SMTP defaults of the environment (SMTP_HOST, MAIL_FROM_ADDRESS, ...) are used as they
 *   are. Nothing is saved and no test mail is sent: the wizard's test needs a running worker, and here the owner has put the
 *   values in `.env` already. Without them the command is refused rather than leave the site mute without a word.
 *   `--skip-email` stores the same notice as the wizard.
 * - The administrator's password is read from standard input (`--admin-password-stdin`) or generated and printed once. The
 *   recovery key is made by the service, printed once and not stored (the database keeps only a verifier).
 * - A site that is installed is refused first, before a question is asked or a password hashed: exit 1, nothing changed.
 */
export async function coreInstall(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  const prompt = options.prompt ?? createTerminalPrompter()
  let given: GivenAnswers
  try {
    given = await readInstallFlags(args, prompt, options)
  } catch (err) {
    if (err instanceof UsageError) {
      return usageResult(err.message, CORE_INSTALL_USAGE)
    }
    throw err
  }

  return await withConfiguredDatabase(options, 'core install', loadSiteDatabaseConfig, async (db, logger, config) => {
    const service = installService(db, config, logger)
    if (await service.isInstalled()) {
      return refusal('The site is already installed. Nothing was changed.')
    }

    const smtpReady = config.SMTP_HOST !== '' && config.MAIL_FROM_ADDRESS !== ''
    let answers: InstallAnswers
    let chosen: ChosenPassword
    try {
      const asked = await askInstallAnswers(given, prompt, config, smtpReady)
      answers = asked
      const origin = new URL(config.PUBLIC_ORIGIN).origin
      if (answers.url !== origin) {
        throw new UsageError(
          `--url: the address of the site is the one in PUBLIC_ORIGIN (${origin}). Change PUBLIC_ORIGIN in the environment (docker/.env) and restart the stack if that address is wrong.`,
        )
      }
      if (!answers.skipEmail && !smtpReady) {
        throw new UsageError(
          'E-mail: SMTP_HOST and MAIL_FROM_ADDRESS are not set in the environment (docker/.env). Set them, or pass --skip-email to install without e-mail; the dashboard will then show a notice.',
        )
      }
      chosen =
        asked.password === undefined
          ? await choosePassword(false, () => Promise.resolve(''))
          : { password: asked.password, generated: false }
      if (isTooObvious(chosen.password, { username: answers.adminUser, email: answers.adminEmail })) {
        throw new UsageError(OBVIOUS_PASSWORD)
      }
    } catch (err) {
      if (err instanceof UsageError) {
        return usageResult(err.message, CORE_INSTALL_USAGE)
      }
      throw err
    }

    let result: Awaited<ReturnType<InstallService['install']>>
    try {
      result = await service.install({
        admin: { username: answers.adminUser, email: answers.adminEmail, password: chosen.password },
        site: {
          locale: answers.locale,
          title: answers.title,
          timezone: answers.timezone,
          adminEmail: answers.adminEmail,
          blogPublic: !answers.noIndex,
        },
        email: answers.skipEmail ? { skip: true } : { fromEnvironment: true },
        source: 'cli',
      })
    } catch (err) {
      // Two installs at once: the one that lost finds the site installed, and nothing of it was written.
      if (err instanceof AlreadyInstalledError) {
        return refusal('The site is already installed. Nothing was changed.')
      }
      if (err instanceof InstallError) {
        return installRefusal(err)
      }
      throw err
    }
    if (result.recoveryKey === null) {
      throw new Error('the install made no recovery key')
    }
    const origin = new URL(config.PUBLIC_ORIGIN).origin
    return {
      code: 0,
      // The two secrets, each on a line of its own and labelled; nothing else is on stdout.
      stdout:
        (chosen.generated ? `Administrator password (generated, shown once): ${chosen.password}\n` : '') +
        `Recovery key (shown once, keep it safe): ${result.recoveryKey}\n`,
      stderr:
        `Installed "${answers.title}". The administrator "${result.username}" signs in at ${origin}/admin/login.\n` +
        'The recovery key' +
        (chosen.generated ? ' and the generated password are' : ' is') +
        ' printed once on standard output and kept nowhere else.\n' +
        (answers.skipEmail
          ? 'E-mail is skipped: the dashboard shows a notice until it is set up.\n'
          : 'E-mail uses the SMTP settings of the environment; no test mail was sent.\n'),
    }
  })
}
