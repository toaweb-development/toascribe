// A migrated database for the job tests, with the app role's connection (what the worker uses) and the owner's (for seeding
// rows the app role could not write, such as old audit log entries).
import { createDb, runMigrations } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { createKeyRing, parseKeyMaterial } from '@toascribe/shared'
import pg from 'pg'
import { pino } from 'pino'
import type { Logger } from 'pino'

import { createTestDatabase } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

export type LogLine = Record<string, unknown>

/** A pino logger that collects its JSON lines in memory. */
export function memoryLogger(level = 'debug') {
  const lines: LogLine[] = []
  const logger: Logger = pino(
    { level },
    {
      write(chunk: string) {
        const parsed: unknown = JSON.parse(chunk)
        if (typeof parsed === 'object' && parsed !== null) {
          lines.push(Object.fromEntries(Object.entries(parsed)))
        }
      },
    },
  )
  return { logger, lines }
}

export const TEST_ENCRYPTION_KEY = parseKeyMaterial('1f2e3d4c5b6a79881706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0')
export const testKeyRing = await createKeyRing({ version: 1, key: TEST_ENCRYPTION_KEY })

export interface JobDb {
  readonly database: TestDatabase
  /** The app role: what the worker runs as. */
  readonly db: Database
  readonly pool: pg.Pool
  /** The owner: for seeding. */
  readonly owner: pg.Pool
  query: <R extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<R[]>
  close: () => Promise<void>
}

export async function startJobDb(): Promise<JobDb> {
  const database = await createTestDatabase()
  try {
    await runMigrations({ connectionString: database.ownerUrl, logger: pino({ level: 'silent' }) })
    const { db, pool } = createDb({
      connectionString: database.appUrl,
      applicationName: 'toascribe-worker-test',
      max: 4,
    })
    const owner = new pg.Pool({ connectionString: database.ownerUrl, max: 2 })
    return {
      database,
      db,
      pool,
      owner,
      async query<R extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []) {
        return (await owner.query<R>(text, [...values])).rows
      },
      async close() {
        await Promise.all([pool.end(), owner.end()])
        await database.drop()
      },
    }
  } catch (err) {
    await database.drop()
    throw err
  }
}
