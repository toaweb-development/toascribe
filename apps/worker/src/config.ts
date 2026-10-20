// All environment variables are read here and nowhere else (typescript §9). A missing or invalid
// value stops the process with a message that names the variable and never prints its value.
import { z } from 'zod'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

/** The worker has no HTTP port and no public origin. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // the app role (toascribe_app), never the owner
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // The heartbeat file the container healthcheck reads (see lib/heartbeat.ts). /tmp is writable
  // in a container even with a read-only root filesystem when it is a tmpfs.
  WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/toascribe-worker.heartbeat'),
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
