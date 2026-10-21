// All environment variables are read here and nowhere else in the cli (typescript §9). The cli parses lazily, per
// command, so `toa --version` needs no environment at all. A bad value is reported by variable name, never by value.
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
