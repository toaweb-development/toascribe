// `toa shell` (M1.7, K-272; WP-CLI's `wp shell`): a Node REPL with the database and the api's services loaded. Only in the container
// (the api image), only at a terminal, and with a warning first: everything typed runs for real with the app role's rights. The
// start is audited («cli»); what is typed is not kept anywhere (no history file).
import { existsSync } from 'node:fs'
import { start } from 'node:repl'

import { openCliServices } from '@toascribe/api/cli'
import { createDb, schema } from '@toascribe/db'
import { sql } from 'drizzle-orm'

import { ConfigError, loadServiceConfig } from '../config.ts'
import { UsageError, failureFields, invalidInput, loggerFor, parseFlags, refusal, usageResult } from '../kit.ts'
import type { CommandOptions } from '../options.ts'
import { createTerminalPrompter } from '../prompt.ts'
import type { CliResult } from '../result.ts'
import { SHELL_USAGE } from '../usage.ts'

export const SHELL_WARNING =
  'WARNING: toa shell runs what you type against the live database with the app role, and the services act for real. ' +
  'Nothing asks first and nothing can be undone. Take a backup first (toa backup create). Type .exit to leave.'

/** In a container: Docker writes /.dockerenv, Podman /run/.containerenv. */
export function inContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv')
}

export async function shell(args: readonly string[], options: CommandOptions = {}): Promise<CliResult> {
  try {
    parseFlags(args, {})
  } catch (err) {
    if (err instanceof UsageError) return usageResult(err.message, SHELL_USAGE)
    throw err
  }
  if (!(options.inContainer ?? inContainer())) {
    return refusal('toa shell runs only in the container: docker compose exec api toa shell')
  }
  const prompt = options.prompt ?? createTerminalPrompter()
  if (!prompt.interactive)
    return invalidInput('toa shell needs a terminal: docker compose exec api toa shell (not -T).')
  let config: ReturnType<typeof loadServiceConfig>
  try {
    config = loadServiceConfig(options.env)
  } catch (err) {
    if (err instanceof ConfigError) return invalidInput(err.message)
    throw err
  }
  const logger = loggerFor(options, config.LOG_LEVEL)
  const { db, pool } = createDb({ connectionString: config.DATABASE_URL, max: 2, applicationName: 'toascribe-shell' })
  const cli = openCliServices({
    db,
    databaseUrl: config.DATABASE_URL,
    logger,
    keyRing: await config.keyRing(),
    publicOrigin: config.PUBLIC_ORIGIN,
    version: options.version ?? '0.0.0',
    uploadsDir: config.UPLOADS_DIR,
    uploadCapMb: config.UPLOAD_MAX_SIZE_MB,
    siteUrlInternal: config.SITE_URL_INTERNAL,
  })
  try {
    await db.insert(schema.auditLog).values({
      actorType: 'system',
      actor: 'cli',
      accountId: null,
      action: 'shell.started',
      objectType: 'system',
      objectId: 'shell',
      source: 'cli',
      ip: null,
    })
    prompt.say(`${SHELL_WARNING}\nLoaded: db, schema, sql, services, actAs(login), ctx.\n`)
    const repl = start({ prompt: 'toa> ', useGlobal: false, breakEvalOnSigint: true })
    Object.assign(repl.context, {
      db,
      schema,
      sql,
      services: cli.services,
      actAs: (login: string) => cli.actAs(login),
      ctx: cli.context,
    })
    await new Promise<void>((resolve) => repl.on('exit', resolve))
    return { code: 0, stdout: '', stderr: '' }
  } catch (err) {
    logger.fatal(failureFields(err), 'shell failed')
    return refusal('shell failed; see the log above')
  } finally {
    await cli.close()
    await pool.end()
  }
}
