import { SCRUBBING_LOG_OPTIONS, scrubChildBindings } from '@toascribe/shared'
import { pino } from 'pino'
import type { Logger, LoggerOptions as PinoOptions } from 'pino'

export type { Logger }

export interface LoggerOptions {
  readonly level: string
  /** pino-pretty is for local development only (typescript §12). */
  readonly pretty: boolean
  /** Where the lines go; stdout by default (a test reads them). */
  readonly destination?: { write(line: string): void }
}

/** Structured JSON to stdout; no console.* anywhere in server code. */
export function createLogger(options: LoggerOptions): Logger {
  const settings: PinoOptions = {
    name: 'toascribe-api',
    level: options.level,
    // Defence in depth: request logging records no headers or bodies, but if one is ever added
    // these never reach the log (security §8).
    redact: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
    // The fixed list of K-297 at any depth, e-mail addresses and credentials in every string, the message and its arguments
    // (shared log-redaction.ts).
    ...(SCRUBBING_LOG_OPTIONS as Pick<PinoOptions, 'formatters' | 'hooks' | 'serializers'>),
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  }
  // Child loggers' bindings are written outside the formatter: `child()` scrubs them first.
  return scrubChildBindings(options.destination === undefined ? pino(settings) : pino(settings, options.destination))
}
