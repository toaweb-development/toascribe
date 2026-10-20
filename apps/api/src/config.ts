// All environment variables are read here and nowhere else (typescript §9). A missing or invalid
// value stops the process with a message that names the variable and never prints its value.
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  // 3001 is the API's port inside the container; the proxy routes /api/* to it.
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // the app role (toascribe_app), never the owner
  PUBLIC_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
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
