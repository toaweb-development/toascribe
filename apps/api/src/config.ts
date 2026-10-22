// All environment variables are read here and nowhere else (typescript §9). A missing or invalid
// value stops the process with a message that names the variable and never prints its value.
import { keyMaterialEnv, oldEncryptionKeysEnv } from '@toascribe/shared'
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    // 3001 is the API's port inside the container; the proxy routes /api/* to it.
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // the app role (toascribe_app), never the owner
    PUBLIC_ORIGIN: z.url(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Encrypts secrets kept in the database (the TOTP secret, the SMTP password): AES-256-GCM, 32 random bytes (K-318). */
    TOASCRIBE_ENCRYPTION_KEY: keyMaterialEnv,
    /** The version number that names TOASCRIBE_ENCRYPTION_KEY in what it encrypts (`v1:...`). Raise it when the key is replaced. */
    TOASCRIBE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
    /** Earlier encryption keys, `v1:<key>,...`, only for reading. Drop one when nothing is encrypted with it any more. */
    TOASCRIBE_ENCRYPTION_OLD_KEYS: oldEncryptionKeysEnv,
    /** Signs the CSRF tokens (HMAC-SHA256). 32 random bytes. A different key from the encryption key. */
    TOASCRIBE_SIGNING_KEY: keyMaterialEnv,
    /**
     * The address or network of the reverse proxy in front of the stack (the proxy container reads the same variable). The api
     * does not use the value: it only needs to know whether it is set, to warn when it is empty and all requests come from one
     * private address (services/proxy-check.ts).
     */
    TOASCRIBE_TRUSTED_PROXY: z.string().trim().max(200).default(''),
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
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])
    if (same(env.TOASCRIBE_SIGNING_KEY, env.TOASCRIBE_ENCRYPTION_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TOASCRIBE_SIGNING_KEY'],
        message: 'must differ from TOASCRIBE_ENCRYPTION_KEY: one key, one purpose',
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
  PORT: Env.shape.PORT,
})

/** What `dist/healthcheck.js` needs: the port only, so it works with a partial environment. */
export function loadHealthcheckConfig(env: EnvSource = process.env): { readonly PORT: number } {
  const parsed = HealthcheckEnv.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues)
  }
  return parsed.data
}
