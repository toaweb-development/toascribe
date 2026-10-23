import type { MailProducer } from '@toascribe/db'
import type { Logger } from 'pino'

import type { EnvSource } from './config.ts'

/** What a command gets from its caller. The process supplies the defaults; tests pass their own. */
export interface CommandOptions {
  /** Defaults to the process environment (read in config.ts). */
  readonly env?: EnvSource
  /** Defaults to a pino logger at LOG_LEVEL, on stderr for the commands that print a result on stdout. */
  readonly logger?: Logger
  /** Reads standard input to its end, for `--password-stdin`. Defaults to the process' stdin. */
  readonly readStdin?: () => Promise<string>
  /** The mail queue the commands that send a notice use. Defaults to a pg-boss producer on DATABASE_URL, stopped when the command ends. */
  readonly mail?: MailProducer
}
