// Work folders a killed run left in the backups volume (M1.7 review): a `.tmp-*` of a backup being made or a `.restore-*` of one being
// restored can hold a dump in plain text, and the volume is meant to be copied off the host. createBackup and checkBackup sweep them,
// and the keys a restore wrote out once they are an hour old (M1.8 security review).
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Work folders (`.tmp-*`, `.restore-*`) older than this are left over from a run that was killed, and are removed. */
const STALE_MS = 6 * 60 * 60 * 1000
/**
 * The keys a restore took out of a backup (`restored-secrets-*.json`, plain text, 0600) are for the operator to put in `.env` at
 * once; older than this, they are removed, so a copy of the volume taken later does not carry them next to the backups.
 */
const SECRETS_STALE_MS = 60 * 60 * 1000

/**
 * Removes work folders a killed run left in the backups volume (they can hold a dump, and an encrypted backup's plain text). A
 * folder younger than STALE_MS may belong to a run in progress (the worker's daily backup) and stays.
 */
export async function sweepWorkFolders(backupsDir: string, now: Date = new Date()): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(backupsDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const work = /^\.(tmp|restore)-[0-9a-f]{12}$/.test(name)
    const secrets = /^restored-secrets-[0-9TZ]+\.json$/.test(name)
    if (!work && !secrets) continue
    const full = join(backupsDir, name)
    const info = await stat(full).catch(() => undefined)
    if (info === undefined || now.getTime() - info.mtimeMs < (secrets ? SECRETS_STALE_MS : STALE_MS)) continue
    await rm(full, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}
