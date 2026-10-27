// All environment variables are read here and nowhere else in the cli (typescript §9). The cli parses lazily, per
// command, so `toa --version` needs no environment at all. A bad value is reported by variable name, never by value.
import { createKeyRing, keyMaterialEnv, oldEncryptionKeysEnv } from '@toascribe/shared'
import type { KeyRing } from '@toascribe/shared'
import { z } from 'zod'

export type EnvSource = Readonly<Record<string, string | undefined>>

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

/** The only NODE_ENV values under which a destructive dev command may run. Anything else, or unset, refuses. */
export const DEV_NODE_ENVS = ['development', 'test'] as const

/** The raw NODE_ENV, for the guard: it must see "unset" and unknown values as they are, not a parse error. */
export function readNodeEnv(env: EnvSource = process.env): string | undefined {
  return env['NODE_ENV']
}

const DatabaseEnv = z.object({
  // The owner role (toascribe_owner): the reset needs TRUNCATE and the migrations, which the app role cannot do.
  MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
})

export type DatabaseConfig = z.infer<typeof DatabaseEnv>

const AppDatabaseEnv = z.object({
  // The app role (toascribe_app, DML only): the same URL the api uses, present in the api container. The user commands
  // need nothing more, so they work in production too.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
})

export type AppDatabaseConfig = z.infer<typeof AppDatabaseEnv>

/** Thrown for a bad environment. The message names variables and rules, never values. */
export class ConfigError extends Error {
  readonly fields: readonly string[]

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `${issue.path.join('.') || '(env)'}: ${issue.message}`)
    super(`Invalid environment: ${lines.join('; ')}`)
    this.name = 'ConfigError'
    this.fields = [...new Set(issues.map((issue) => issue.path.join('.')))]
  }
}

/** What the commands that talk to the database need: the owner role's URL and the log level. */
export function loadDatabaseConfig(env: EnvSource = process.env): DatabaseConfig {
  const parsed = DatabaseEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}

/** What the commands that run as the app role need: its URL and the log level. */
export function loadAppDatabaseConfig(env: EnvSource = process.env): AppDatabaseConfig {
  const parsed = AppDatabaseEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}

const SiteDatabaseEnv = AppDatabaseEnv.extend({
  // The address visitors use: where the setup wizard lives, and what the default content's links are made from.
  PUBLIC_ORIGIN: z.url(),
  // The e-mail defaults of the worker (docker/.env.example). `core install` needs to know only whether they are there.
  SMTP_HOST: z.string().trim().default(''),
  MAIL_FROM_ADDRESS: z.string().trim().default(''),
})

export type SiteDatabaseConfig = z.infer<typeof SiteDatabaseEnv>

/** What `toa core install` and `toa core setup-token` need: the app role's URL, the site's address and the log level. */
export function loadSiteDatabaseConfig(env: EnvSource = process.env): SiteDatabaseConfig {
  const parsed = SiteDatabaseEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}

const KeyedDatabaseEnv = AppDatabaseEnv.extend({
  // The key ring seals the token of a one-time link before the mail job is stored (a mail with a link needs it, a notice does not).
  TOASCRIBE_ENCRYPTION_KEY: keyMaterialEnv,
  TOASCRIBE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
  TOASCRIBE_ENCRYPTION_OLD_KEYS: oldEncryptionKeysEnv,
})

export type KeyedDatabaseConfig = z.infer<typeof KeyedDatabaseEnv>

/** The app role's URL and the encryption key: for the commands that queue a mail with a one-time link. Read only on that path. */
export function loadKeyedDatabaseConfig(env: EnvSource = process.env): KeyedDatabaseConfig {
  const parsed = KeyedDatabaseEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}

/** The key ring of a keyed config, as the api and the worker build theirs. */
export function keyRingOf(config: KeyedDatabaseConfig): Promise<KeyRing> {
  return createKeyRing(
    { version: config.TOASCRIBE_ENCRYPTION_KEY_VERSION, key: config.TOASCRIBE_ENCRYPTION_KEY },
    config.TOASCRIBE_ENCRYPTION_OLD_KEYS,
  )
}

/** Which of `names` are set (not empty) in the environment. Names only: `core gen-env` must not touch the values. */
export function namesSet(names: readonly string[], env: EnvSource = process.env): string[] {
  return names.filter((name) => (env[name] ?? '').trim() !== '')
}

/** Where backups are made and read (M1.7): the volumes and toascribe.toml, with the paths compose uses as defaults. */
const BackupPaths = {
  UPLOADS_DIR: z.string().startsWith('/').max(500).default('/var/lib/toascribe/uploads'),
  BACKUPS_DIR: z.string().startsWith('/').max(500).default('/var/lib/toascribe/backups'),
  TOASCRIBE_CONFIG_FILE: z.string().startsWith('/').max(500).default('/etc/toascribe/toascribe.toml'),
}

/**
 * The keys a backup keeps with --include-secrets, as they are set (only read on that path, and only into an encrypted backup): the
 * encryption key, its version and the older keys, and the signing key.
 */
const SecretValues = {
  TOASCRIBE_ENCRYPTION_KEY: z.string().default(''),
  TOASCRIBE_ENCRYPTION_KEY_VERSION: z.string().default(''),
  TOASCRIBE_ENCRYPTION_OLD_KEYS: z.string().default(''),
  TOASCRIBE_SIGNING_KEY: z.string().default(''),
}

/** `toa check-update` (M1.7, K-290): `off` turns the update check off on this server, whatever the setting says. */
const UpdateCheckEnv = AppDatabaseEnv.extend({
  TOASCRIBE_UPDATE_CHECK: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['on', 'off']).optional()),
})
export type UpdateCheckConfig = z.infer<typeof UpdateCheckEnv>

export function loadUpdateCheckConfig(env: EnvSource = process.env): UpdateCheckConfig {
  const parsed = UpdateCheckEnv.safeParse(env)
  if (!parsed.success) throw new ConfigError(parsed.error.issues)
  return parsed.data
}

const BackupEnv = AppDatabaseEnv.extend(BackupPaths)
export type BackupConfig = z.infer<typeof BackupEnv>

/** `toa backup create|list|verify|prune`: the app role's URL and the paths. */
export function loadBackupConfig(env: EnvSource = process.env): BackupConfig {
  const parsed = BackupEnv.safeParse(env)
  if (!parsed.success) throw new ConfigError(parsed.error.issues)
  return parsed.data
}

const OwnerBackupEnv = DatabaseEnv.extend(BackupPaths)
export type OwnerBackupConfig = z.infer<typeof OwnerBackupEnv>

/** `toa backup restore`, `toa db migrate` and `toa core update`: the owner role's URL (the migrate service) and the paths. */
export function loadOwnerBackupConfig(env: EnvSource = process.env): OwnerBackupConfig {
  const parsed = OwnerBackupEnv.safeParse(env)
  if (!parsed.success) throw new ConfigError(parsed.error.issues)
  return parsed.data
}

/** The keys for --include-secrets, as set; the empty ones left out. */
export function loadSecretValues(env: EnvSource = process.env): Record<string, string> {
  const parsed = z.object(SecretValues).parse(env)
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== ''))
}
