import { pino } from 'pino'
import type { Logger } from 'pino'

export type { Logger }

export interface LoggerOptions {
  readonly level: string
  /** pino-pretty is for local development only (typescript §12). */
  readonly pretty: boolean
}

/** Structured JSON to stdout; no console.* anywhere in server code. */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: 'toascribe-worker',
    level: options.level,
    // Defence in depth: request logging records no headers or bodies, but if one is ever added
    // these never reach the log (security §8).
    redact: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  })
}
