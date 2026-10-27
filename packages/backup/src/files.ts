// The backups in the backups volume: listed newest first, pruned to the newest N, and the database's newest migration for a manifest.
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { DbExecutor } from '@toascribe/db'
import { readMigrationJournal } from '@toascribe/db'
import { sql } from 'drizzle-orm'

import { ARCHIVE_NAME } from './manifest.ts'

export interface ListedBackup {
  readonly name: string
  readonly file: string
  readonly size: number
  readonly modifiedAt: Date
  readonly encrypted: boolean
}

/** The backups in the folder, newest first (by the time in the name, which sorts). */
export async function listBackups(backupsDir: string): Promise<ListedBackup[]> {
  let names: string[]
  try {
    names = await readdir(backupsDir)
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') return []
    throw error
  }
  const backups = await Promise.all(
    names
      .filter((name) => ARCHIVE_NAME.test(name))
      .map(async (name) => {
        const file = join(backupsDir, name)
        const info = await stat(file)
        return { name, file, size: info.size, modifiedAt: info.mtime, encrypted: name.endsWith('.age') }
      }),
  )
  return backups.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
}

/** Deletes all but the newest `keep` backups; the deleted ones, oldest last. */
export async function pruneBackups(backupsDir: string, keep: number): Promise<ListedBackup[]> {
  const removed = (await listBackups(backupsDir)).slice(keep)
  for (const backup of removed) await rm(backup.file, { force: true })
  return removed
}

/** A file in the backups folder by its name only (no path: `list` shows the names), or undefined when there is none. */
export async function findBackup(backupsDir: string, name: string): Promise<ListedBackup | undefined> {
  if (!ARCHIVE_NAME.test(name)) return undefined
  return (await listBackups(backupsDir)).find((backup) => backup.name === name)
}

/** The newest migration the database has: its journal tag and time (`none` and 0 for a database with none). */
export async function readDatabaseMigration<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
): Promise<{ tag: string; when: number }> {
  const result = await db.execute(
    sql`select coalesce(max(created_at), 0)::text as latest from drizzle.__drizzle_migrations`,
  )
  const when = Number((result.rows[0] as { latest?: string } | undefined)?.latest ?? 0)
  const entry = readMigrationJournal().find((candidate) => candidate.when === when)
  return { tag: entry?.tag ?? (when === 0 ? 'none' : 'unknown'), when }
}
