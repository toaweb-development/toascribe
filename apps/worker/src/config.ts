// All environment variables are read here and nowhere else (typescript §9). A missing or invalid
// value stops the process with a message that names the variable and never prints its value.
import { SMTP_SECURE_MODES, keyMaterialEnv, oldEncryptionKeysEnv } from '@toascribe/shared'
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

/** A variable that docker compose passes as an empty string when it is not set (`${VAR:-}`) counts as not set. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

/** A host name or an IP address, as nodemailer takes it. The same rule as the `smtp_host` setting. */
const smtpHost = z
  .string()
  .max(253)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$|^[0-9A-Fa-f:.]+$/)

/** One line, no control characters: a value that goes into a mail header cannot break it (CR/LF injection). */
const oneLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => !/\p{Cc}/u.test(text), {
      message: 'must be one line, without control characters',
    })

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // the app role (toascribe_app), never the owner
    // The address visitors use. The links in the mails are built on it and on nothing else (no PORT: the worker has none).
    PUBLIC_ORIGIN: z.url(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // The heartbeat file the container healthcheck reads (see lib/heartbeat.ts). /tmp is writable
    // in a container even with a read-only root filesystem when it is a tmpfs.
    WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/toascribe-worker.heartbeat'),

    // The keys: the worker decrypts the SMTP password (a setting) and the one-time tokens in the e-mail jobs. Same variables and
    // meaning as in the api (K-318); the signing key is not needed here.
    TOASCRIBE_ENCRYPTION_KEY: keyMaterialEnv,
    TOASCRIBE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
    TOASCRIBE_ENCRYPTION_OLD_KEYS: oldEncryptionKeysEnv,

    // E-mail defaults. The settings smtp_* and mail_from_* win when they are set (null in the settings means «use these»);
    // a mail cannot be sent until a host and a sender address come from one place or the other.
    SMTP_HOST: optional(smtpHost),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
    /** `none` is plain SMTP, `starttls` upgrades the connection (and refuses to send without it), `tls` connects with TLS (port 465). */
    SMTP_SECURE: optional(z.enum(SMTP_SECURE_MODES)),
    SMTP_USERNAME: optional(oneLine(320)),
    SMTP_PASSWORD: optional(z.string().min(1).max(1000)),
    MAIL_FROM_ADDRESS: optional(z.email().max(254)),
    MAIL_FROM_NAME: optional(oneLine(200)),
  })
  .superRefine((env, ctx) => {
    const versions = [
      env.TOASCRIBE_ENCRYPTION_KEY_VERSION,
      ...env.TOASCRIBE_ENCRYPTION_OLD_KEYS.map((entry) => entry.version),
    ]
    if (new Set(versions).size !== versions.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['TOASCRIBE_ENCRYPTION_OLD_KEYS'],
        message: 'a version appears twice (also counting TOASCRIBE_ENCRYPTION_KEY_VERSION)',
      })
    }
  })

export type Config = z.infer<typeof Env>

export type EnvSource = Readonly<Record<string, string | undefined>>

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

export function loadConfig(env: EnvSource = process.env): Config {
  const parsed = Env.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}

const HealthcheckEnv = z.object({
  WORKER_HEARTBEAT_FILE: Env.shape.WORKER_HEARTBEAT_FILE,
})

/** What `dist/healthcheck.js` needs: the heartbeat path only, so it works with a partial environment. */
export function loadHealthcheckConfig(env: EnvSource = process.env): { readonly WORKER_HEARTBEAT_FILE: string } {
  const parsed = HealthcheckEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}
