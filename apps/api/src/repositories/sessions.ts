// The only place that reads and writes `session` (typescript §8). A row is found by the hash of its token; the token itself
// never reaches the database. Ownership is part of every query that takes a session id from a request (security §2, BOLA).
import { schema } from '@toascribe/db'
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm'

import { accountViewColumns } from './accounts.ts'
import type { AccountView } from './accounts.ts'
import type { Executor } from './executor.ts'

const { account, session } = schema

export interface SessionRecord {
  readonly id: string
  readonly accountId: string
  readonly ip: string | null
  readonly userAgent: string | null
  readonly expiresAt: Date
  readonly lastSeenAt: Date
  readonly createdAt: Date
  readonly mfaVerifiedAt: Date | null
  readonly isRemembered: boolean
}

const sessionColumns = {
  id: session.id,
  accountId: session.accountId,
  ip: session.ip,
  userAgent: session.userAgent,
  expiresAt: session.expiresAt,
  lastSeenAt: session.lastSeenAt,
  createdAt: session.createdAt,
  mfaVerifiedAt: session.mfaVerifiedAt,
  isRemembered: session.isRemembered,
} as const

export interface NewSession {
  readonly accountId: string
  readonly tokenHash: string
  readonly ip: string | null
  readonly userAgent: string | null
  readonly expiresAt: Date
  readonly mfaVerifiedAt: Date | null
  readonly isRemembered: boolean
  readonly now: Date
}

export async function insertSession(db: Executor, input: NewSession): Promise<SessionRecord> {
  const rows = await db
    .insert(session)
    .values({
      accountId: input.accountId,
      tokenHash: input.tokenHash,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt: input.expiresAt,
      lastSeenAt: input.now,
      mfaVerifiedAt: input.mfaVerifiedAt,
      isRemembered: input.isRemembered,
      createdAt: input.now,
      modifiedAt: input.now,
    })
    .returning(sessionColumns)
  const row = rows[0]
  if (row === undefined) {
    throw new Error('the session insert returned no row')
  }
  return row
}

export interface SessionWithAccount {
  readonly session: SessionRecord
  readonly account: AccountView
}

/** The live session behind a token hash, with its account. Expired sessions are not found. */
export async function findLiveSession(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<SessionWithAccount | undefined> {
  const rows = await db
    .select({
      session: sessionColumns,
      account: accountViewColumns,
    })
    .from(session)
    .innerJoin(account, eq(account.id, session.accountId))
    .where(and(eq(session.tokenHash, tokenHash), gt(session.expiresAt, now)))
    .limit(1)
  return rows[0]
}

/** The account's live sessions, newest first. */
export function listLiveSessions(db: Executor, accountId: string, now: Date): Promise<SessionRecord[]> {
  return db
    .select(sessionColumns)
    .from(session)
    .where(and(eq(session.accountId, accountId), gt(session.expiresAt, now)))
    .orderBy(sql`${session.createdAt} desc`, session.id)
}

/**
 * Moves `last_seen_at` forward, but only when the stored value is older than `olderThan`: the throttle lives in the
 * statement, so two requests at once write once. Returns whether it wrote.
 */
export async function touchSession(db: Executor, sessionId: string, now: Date, olderThan: Date): Promise<boolean> {
  const rows = await db
    .update(session)
    .set({ lastSeenAt: now, modifiedAt: now })
    .where(and(eq(session.id, sessionId), lt(session.lastSeenAt, olderThan)))
    .returning({ id: session.id })
  return rows.length > 0
}

/** Deletes one session of this account. False when the account has no such session (the same answer for someone else's). */
export async function deleteOwnSession(db: Executor, accountId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.accountId, accountId)))
    .returning({ id: session.id })
  return rows.length > 0
}

/** Deletes every session of the account except `keepSessionId`. Returns how many it deleted. */
export async function deleteOtherSessions(db: Executor, accountId: string, keepSessionId: string): Promise<number> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.accountId, accountId), ne(session.id, keepSessionId)))
    .returning({ id: session.id })
  return rows.length
}

/** Gives the session a new token and records that the second factor was passed. Returns false if the row is gone. */
export async function replaceTokenAfterMfa(
  db: Executor,
  sessionId: string,
  tokenHash: string,
  expiresAt: Date,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(session)
    .set({ tokenHash, expiresAt, mfaVerifiedAt: now, modifiedAt: now })
    .where(eq(session.id, sessionId))
    .returning({ id: session.id })
  return rows.length > 0
}
