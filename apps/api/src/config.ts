// All environment variables are read here and nowhere else (typescript §9). A missing or invalid
// value stops the process with a message that names the variable and never prints its value.
import { KeyMaterialError, parseKeyMaterial } from '@toascribe/shared'
import type { VersionedKey } from '@toascribe/shared'
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

/**
 * A 32-byte key from the environment. The message names the rule, never the value (a key in a log is a leaked key), and
 * Zod's issue carries no input of its own.
 */
const keyMaterial = z.string().transform((text, ctx) => {
  try {
    return parseKeyMaterial(text)
  } catch (err) {
    ctx.issues.push({
      code: 'custom',
      message: err instanceof KeyMaterialError ? err.message : 'is not a usable key',
      input: '',
    })
    return z.NEVER
  }
})

/**
 * `v1:<key>,v2:<key>`: the older encryption keys, kept so values written with them can still be read. Empty or unset: none.
 */
const oldEncryptionKeys = z
  .string()
  .default('')
  .transform((text, ctx): VersionedKey[] => {
    const keys: VersionedKey[] = []
    for (const entry of text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')) {
      const match = /^v([1-9]\d{0,3}):(.+)$/.exec(entry)
      const version = match?.[1]
      const material = match?.[2]
      if (version === undefined || material === undefined) {
        ctx.issues.push({ code: 'custom', message: 'each entry is v<number>:<key>, separated by commas', input: '' })
        return z.NEVER
      }
      try {
        keys.push({ version: Number(version), key: parseKeyMaterial(material) })
      } catch {
        ctx.issues.push({
          code: 'custom',
          message: 'an entry has a key that is not 32 random bytes in hex or base64',
          input: '',
        })
        return z.NEVER
      }
    }
    return keys
  })

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    // 3001 is the API's port inside the container; the proxy routes /api/* to it.
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // the app role (toascribe_app), never the owner
    PUBLIC_ORIGIN: z.url(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Encrypts secrets kept in the database (the TOTP secret, the SMTP password): AES-256-GCM, 32 random bytes (K-318). */
    TOASCRIBE_ENCRYPTION_KEY: keyMaterial,
    /** The version number that names TOASCRIBE_ENCRYPTION_KEY in what it encrypts (`v1:...`). Raise it when the key is replaced. */
    TOASCRIBE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
    /** Earlier encryption keys, `v1:<key>,...`, only for reading. Drop one when nothing is encrypted with it any more. */
    TOASCRIBE_ENCRYPTION_OLD_KEYS: oldEncryptionKeys,
    /** Signs the CSRF tokens (HMAC-SHA256). 32 random bytes. A different key from the encryption key. */
    TOASCRIBE_SIGNING_KEY: keyMaterial,
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
