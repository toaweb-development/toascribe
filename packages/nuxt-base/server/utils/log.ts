// The Nuxt servers' log (M1.8, K-297): one JSON line per entry on stdout, in pino's shape (level as a number, time in ms, `name`),
// so the site's and the admin's lines read like the api's and the worker's. Every line goes through the shared scrubber: the fixed
// list of hidden fields at any depth, and e-mail addresses and credentials in every string. No console.*.
import { scrubForLog } from '@toascribe/shared'

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const
export type LogLevel = keyof typeof LEVELS

function threshold(): number {
  const config = useRuntimeConfig()
  if (config.toascribeDebug === '1') return LEVELS.debug
  const level = config.logLevel as string
  return level in LEVELS ? LEVELS[level as LogLevel] : LEVELS.info
}

export function logLine(level: LogLevel, fields: Record<string, unknown>, msg: string): void {
  if (LEVELS[level] < threshold()) return
  const name = `toascribe-${String(useRuntimeConfig().appName)}`
  const line = scrubForLog({ level: LEVELS[level], time: Date.now(), name, ...fields, msg })
  process.stdout.write(`${JSON.stringify(line)}\n`)
}
