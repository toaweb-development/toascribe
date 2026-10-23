// Whether the database has every migration that this build ships (the setup wizard's system check). The migrator
// (migrator.ts) runs as the owner before the api starts, so a mismatch means the migrate step was skipped, failed, or is
// older than the code. Read as the app role: migration 0006 gives it SELECT on the migrator's bookkeeping table.
import { readFileSync } from 'node:fs'

import { sql } from 'drizzle-orm'
import { z } from 'zod'

import type { DbExecutor } from './executor.ts'
import { MIGRATIONS_FOLDER } from './migrator.ts'

const Journal = z.object({
  entries: z.array(z.object({ tag: z.string().min(1), when: z.number().int() })),
})

export interface MigrationStatus {
  /** True when the newest migration of the journal is applied. */
  readonly upToDate: boolean
  /** Migrations the database has recorded. */
  readonly applied: number
  /** Migrations in the journal of this build. */
  readonly expected: number
  /** The tag of the newest migration of this build, e.g. `0006_setup_attempts`. */
  readonly latest: string
}

/** The migrations this build ships, oldest first, from `migrations/meta/_journal.json`. */
export function readMigrationJournal(folder: string = MIGRATIONS_FOLDER): { tag: string; when: number }[] {
  const text = readFileSync(`${folder}/meta/_journal.json`, 'utf8')
  return Journal.parse(JSON.parse(text)).entries
}

/**
 * Compares the migrator's table with the journal. Drizzle applies a migration when its journal time is newer than the
 * newest recorded one, so «up to date» is the same test the migrator makes: the newest recorded time has reached the newest
 * journal time (and nothing is missing from the count).
 */
export async function getMigrationStatus<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  folder: string = MIGRATIONS_FOLDER,
): Promise<MigrationStatus> {
  const journal = readMigrationJournal(folder)
  const newest = journal.at(-1)
  if (newest === undefined) {
    throw new Error('the migration journal is empty')
  }
  const result = await db.execute(
    sql`select count(*)::int as applied, coalesce(max(created_at), 0)::text as latest from drizzle.__drizzle_migrations`,
  )
  const row = z.object({ applied: z.number().int(), latest: z.string() }).parse(result.rows[0])
  return {
    upToDate: Number(row.latest) >= newest.when && row.applied >= journal.length,
    applied: row.applied,
    expected: journal.length,
    latest: newest.tag,
  }
}
