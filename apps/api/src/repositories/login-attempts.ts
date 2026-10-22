// The only place that reads and writes `login_attempt` (typescript §8). Append-only; the worker deletes old rows.
import { schema } from '@toascribe/db'
import type { LoginAttemptAction } from '@toascribe/shared'
import { and, desc, eq, gt, or, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { loginAttempt } = schema

export interface AttemptRecord {
  readonly at: Date
  readonly succeeded: boolean
}

/** Writes one attempt and returns its id. */
export async function insertLoginAttempt(
  db: Executor,
  input: {
    readonly action: LoginAttemptAction
    readonly ip: string
    readonly accountId: string | null
    /** The keyed hash of the login name or address that was typed; null where none was (a code, a re-authentication, a reset marker). */
    readonly loginHash: string | null
    readonly succeeded: boolean
    readonly at: Date
  },
): Promise<string> {
  const rows = await db
    .insert(loginAttempt)
    .values({
      action: input.action,
      ip: input.ip,
      accountId: input.accountId,
      loginHash: input.loginHash,
      succeeded: input.succeeded,
      createdAt: input.at,
    })
    .returning({ id: loginAttempt.id })
  const row = rows[0]
  if (row === undefined) {
    throw new Error('the login attempt insert returned no row')
  }
  return row.id
}

/** Marks an attempt as right. */
export async function markAttemptSucceeded(db: Executor, attemptId: string): Promise<void> {
  await db.update(loginAttempt).set({ succeeded: true }).where(eq(loginAttempt.id, attemptId))
}

/**
 * Takes a PostgreSQL advisory lock named by `name` until the end of the transaction, so that the read of a subject's
 * attempts and the write of the next one cannot be interleaved with another request's. Only meaningful inside a transaction.
 */
export async function lockSubject(db: Executor, name: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`)
}

/** At most this many rows are read for one subject: the newest ones. Attempts that had to wait are not recorded, so it is far more than a delay needs. */
const MAX_ROWS = 2000

/** The attempts one IP address made since `since`, oldest first (the newest MAX_ROWS of them). */
export async function listAttemptsByIp(
  db: Executor,
  action: LoginAttemptAction,
  ip: string,
  since: Date,
): Promise<AttemptRecord[]> {
  const rows = await db
    .select({ at: loginAttempt.createdAt, succeeded: loginAttempt.succeeded })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.action, action), eq(loginAttempt.ip, ip), gt(loginAttempt.createdAt, since)))
    .orderBy(desc(loginAttempt.createdAt), desc(loginAttempt.id))
    .limit(MAX_ROWS)
  return rows.reverse()
}

/**
 * The attempts made on one account, or with one login name, since `since`, oldest first (the newest MAX_ROWS of them). Either
 * may be missing, not both. The account side finds the attempts whatever form of its name was typed; the name side finds those
 * of a name that has no account (yet), and a succeeded row of the account ends the streak of both.
 */
export async function listAttemptsByName(
  db: Executor,
  action: LoginAttemptAction,
  subject: { readonly accountId: string | null; readonly loginHash: string | null },
  since: Date,
): Promise<AttemptRecord[]> {
  const sides = [
    subject.accountId === null ? undefined : eq(loginAttempt.accountId, subject.accountId),
    subject.loginHash === null ? undefined : eq(loginAttempt.loginHash, subject.loginHash),
  ]
  const rows = await db
    .select({ at: loginAttempt.createdAt, succeeded: loginAttempt.succeeded })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.action, action), or(...sides), gt(loginAttempt.createdAt, since)))
    .orderBy(desc(loginAttempt.createdAt), desc(loginAttempt.id))
    .limit(MAX_ROWS)
  return rows.reverse()
}
