// Application passwords (K-016): a name, the hash of a generated password, and when and from where it was last used.
import { schema } from '@toascribe/db'
import { and, asc, count, eq, lt, or, isNull } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { appPassword } = schema

export interface AppPasswordRow {
  readonly id: string
  readonly accountId: string
  readonly name: string
  readonly passwordHash: string
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
  readonly lastUsedIp: string | null
}

const columns = {
  id: appPassword.id,
  accountId: appPassword.accountId,
  name: appPassword.name,
  passwordHash: appPassword.passwordHash,
  createdAt: appPassword.createdAt,
  lastUsedAt: appPassword.lastUsedAt,
  lastUsedIp: appPassword.lastUsedIp,
}

export function listAppPasswords(db: Executor, accountId: string): Promise<AppPasswordRow[]> {
  return db
    .select(columns)
    .from(appPassword)
    .where(eq(appPassword.accountId, accountId))
    .orderBy(asc(appPassword.createdAt))
}

export async function countAppPasswords(db: Executor, accountId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(appPassword).where(eq(appPassword.accountId, accountId))
  return row?.n ?? 0
}

export async function insertAppPassword(
  db: Executor,
  input: { accountId: string; name: string; passwordHash: string; now: Date },
): Promise<AppPasswordRow> {
  const [row] = await db
    .insert(appPassword)
    .values({
      accountId: input.accountId,
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: input.now,
      modifiedAt: input.now,
    })
    .returning(columns)
  if (row === undefined) throw new Error('the application password insert returned no row')
  return row
}

/** Deletes one of the account's passwords; false when it has none with that id. */
export async function deleteAppPassword(db: Executor, accountId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(appPassword)
    .where(and(eq(appPassword.id, id), eq(appPassword.accountId, accountId)))
    .returning({ id: appPassword.id })
  return rows.length === 1
}

/** When and from where it was used, at most once per `staleBefore` (a busy client does not write on every request). */
export async function touchAppPassword(
  db: Executor,
  id: string,
  now: Date,
  ip: string | null,
  staleBefore: Date,
): Promise<void> {
  await db
    .update(appPassword)
    .set({ lastUsedAt: now, lastUsedIp: ip })
    .where(and(eq(appPassword.id, id), or(isNull(appPassword.lastUsedAt), lt(appPassword.lastUsedAt, staleBefore))))
}
