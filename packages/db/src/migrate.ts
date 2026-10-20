#!/usr/bin/env node
// Migration entry point: `node dist/migrate.js` (`pnpm --filter @toascribe/db migrate`).
// The compose migration step runs it as the owner role before the api and worker start.
// It is the only code that reads MIGRATION_DATABASE_URL (typescript §9, §10).
import { pino } from 'pino'
import { z } from 'zod'

import { runMigrations } from './migrator.ts'

const Env = z.object({
  MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }), // owner role, see POSTGRESQL_STANDARD
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

async function main(): Promise<number> {
  const parsed = Env.safeParse(process.env)
  const logger = pino({ name: 'toascribe-migrate', level: parsed.success ? parsed.data.LOG_LEVEL : 'info' })
  if (!parsed.success) {
    // Names only: the values (a URL with a password) never reach the log.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
    logger.fatal({ fields }, 'invalid environment: MIGRATION_DATABASE_URL must be a postgres:// URL for the owner role')
    return 1
  }
  try {
    await runMigrations({ connectionString: parsed.data.MIGRATION_DATABASE_URL, logger })
    logger.info('migrations complete')
    return 0
  } catch (err) {
    logger.fatal({ err }, 'migration failed')
    return 1
  }
}

process.exitCode = await main()
