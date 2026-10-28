import type { MailProducer } from '@toascribe/db'
import type { ActiveThemeSource, EmbedFetch } from '@toascribe/api/cli'
import type { UpdateSource } from '@toascribe/updates'
import type { Logger } from 'pino'

import type { EnvSource } from './config.ts'
import type { Prompter } from './prompt.ts'

/** What a command gets from its caller. The process supplies the defaults; tests pass their own. */
export interface CommandOptions {
  /** Defaults to the process environment (read in config.ts). */
  readonly env?: EnvSource
  /** Defaults to a pino logger at LOG_LEVEL, on stderr for the commands that print a result on stdout. */
  readonly logger?: Logger
  /** Reads standard input to its end, for `--password-stdin`. Defaults to the process' stdin. */
  readonly readStdin?: () => Promise<string>
  /** Asks questions at the keyboard, for `core install` without flags. Defaults to the process' terminal. */
  readonly prompt?: Prompter
  /** The mail queue the commands that send a notice use. Defaults to a pg-boss producer on DATABASE_URL, stopped when the command ends. */
  readonly mail?: MailProducer
  /** Where `check-update` looks for releases. Defaults to ghcr.io; tests pass stored answers. */
  readonly updateSource?: UpdateSource
  /** The version that runs (run() passes it to the commands that need it). */
  readonly version?: string
  /** For `toa secrets import`: whether standard output is a terminal (it must not be). Defaults to the process'. */
  readonly stdoutIsTerminal?: boolean
  /** For `toa shell`: whether this runs in a container (default: /.dockerenv or /run/.containerenv exists). */
  readonly inContainer?: boolean
  /** For `toa post|term|menu`: the site's active theme and the oEmbed fetch; tests pass their own, never the network. */
  readonly serviceOverrides?: { readonly activeTheme?: ActiveThemeSource; readonly embedFetch?: EmbedFetch }
}
