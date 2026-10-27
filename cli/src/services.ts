// The api's services for the content commands (M1.7, K-263, K-264): `toa post|term|menu|option` validate with the same shared
// schemas as the routes and call the same services, as the account named by --user, so a command is refused exactly where the api
// would refuse it. Exit codes: a request the schema or the service refuses (400, 422) is invalid input (2); not found, not allowed
// or a conflict (403, 404, 409) is an error underway (1).
import { AppError, UnknownActorError, openCliServices } from '@toascribe/api/cli'
import type { CliServices, RequestContext, SessionAuth, Services } from '@toascribe/api/cli'
import { createDb } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import { z } from 'zod'

import { ConfigError, loadServiceConfig } from './config.ts'
import { failureFields, invalidInput, loggerFor, refusal } from './kit.ts'
import type { CommandOptions } from './options.ts'
import type { CliResult } from './result.ts'

export interface ServiceRun {
  readonly db: Database
  readonly services: Services
  readonly auth: SessionAuth
  readonly ctx: RequestContext
  readonly logger: Logger
}

/** The message of a refused request, with the fields the schema named (never a value). */
function zodMessage(error: ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || '(input)'))]
  return `Invalid input: ${fields.join(', ')}.`
}

/** Runs `work` with the services as --user; maps what fails to the exit codes. */
export async function withServices(
  options: CommandOptions,
  command: string,
  user: string | undefined,
  work: (run: ServiceRun) => Promise<CliResult>,
): Promise<CliResult> {
  if (user === undefined || user.trim() === '') {
    return invalidInput(`${command} needs --user <username or e-mail>: the command acts with that account's rights.`)
  }
  let config: ReturnType<typeof loadServiceConfig>
  try {
    config = loadServiceConfig(options.env)
  } catch (err) {
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  const { db, pool } = createDb({ connectionString: config.DATABASE_URL, max: 2, applicationName: 'toascribe-cli' })
  pool.on('error', (err) => {
    logger.error(failureFields(err), 'database connection error')
  })
  let cli: CliServices | undefined
  try {
    cli = openCliServices({
      db,
      databaseUrl: config.DATABASE_URL,
      logger,
      keyRing: await config.keyRing(),
      publicOrigin: config.PUBLIC_ORIGIN,
      version: options.version ?? '0.0.0',
      uploadsDir: config.UPLOADS_DIR,
      uploadCapMb: config.UPLOAD_MAX_SIZE_MB,
      siteUrlInternal: config.SITE_URL_INTERNAL,
      ...(options.serviceOverrides?.activeTheme === undefined
        ? {}
        : { activeTheme: options.serviceOverrides.activeTheme }),
      ...(options.serviceOverrides?.embedFetch === undefined
        ? {}
        : { embedFetch: options.serviceOverrides.embedFetch }),
    })
    const auth = await cli.actAs(user)
    return await work({ db, services: cli.services, auth, ctx: cli.context, logger })
  } catch (err) {
    if (err instanceof UnknownActorError) return invalidInput(`--user: ${err.message}`)
    if (err instanceof ZodError) return invalidInput(zodMessage(err))
    if (err instanceof AppError) {
      const line = `${err.code}: ${err.message}`
      return err.status === 400 || err.status === 422 ? invalidInput(line) : refusal(line)
    }
    logger.fatal(failureFields(err), `${command} failed`)
    return refusal(`${command} failed; see the log above`)
  } finally {
    await cli?.close()
    await pool.end()
  }
}

/** `--format table|json`. */
export const Format = z.enum(['table', 'json'])
export type Format = z.infer<typeof Format>

/** Rows as a plain table: a header, then one line per row, columns padded; or the rows as JSON. */
export function render(rows: readonly Record<string, unknown>[], columns: readonly string[], format: Format): string {
  if (format === 'json') return `${JSON.stringify(rows, null, 2)}\n`
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.replace(/\s+/g, ' ').slice(0, 80)
  }
  const table = [columns, ...rows.map((row) => columns.map((column) => cell(row[column])))]
  const widths = columns.map((_, index) => Math.max(...table.map((line) => (line[index] ?? '').length)))
  return `${table
    .map((line) =>
      line
        .map((value, index) => value.padEnd(widths[index] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')}\n`
}

/** One object, as `key  value` lines or JSON. */
export function renderOne(item: Record<string, unknown>, format: Format): string {
  if (format === 'json') return `${JSON.stringify(item, null, 2)}\n`
  return render(
    Object.entries(item).map(([field, value]) => ({ field, value })),
    ['field', 'value'],
    'table',
  )
}

/** The first argument when it is not a flag (an id, a key, a taxonomy), and the rest. */
export function takeArgument(args: readonly string[]): [string | undefined, string[]] {
  const [first, ...rest] = args
  return first === undefined || first.startsWith('--') ? [undefined, [...args]] : [first, rest]
}
