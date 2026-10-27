// The only place that reads and writes `account_token` (typescript §8): one-time links for a password reset, a first password
// and an e-mail change. A link holds the token, the row only its SHA-256. A row is found by that hash and must then be
// checked for purpose, expiry and use; the caller marks it used in the same transaction as the change it authorises.
import { schema } from '@toascribe/db'
import type { AccountTokenPurpose } from '@toascribe/shared'
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { account, accountToken } = schema

export interface NewAccountToken {
  readonly accountId: string
  readonly purpose: AccountTokenPurpose
  readonly tokenHash: string
  /** email_change only. */
  readonly newEmail: string | null
  readonly expiresAt: Date
  readonly now: Date
}

export async function insertAccountToken(db: Executor, input: NewAccountToken): Promise<void> {
  await db.insert(accountToken).values({
    accountId: input.accountId,
    purpose: input.purpose,
    tokenHash: input.tokenHash,
    newEmail: input.newEmail,
    expiresAt: input.expiresAt,
    createdAt: input.now,
    modifiedAt: input.now,
  })
}

/** Uses up the account's links that are still unused, for these purposes (all of them when none is named). Returns how many. */
export async function invalidateUnusedTokens(
  db: Executor,
  accountId: string,
  now: Date,
  purposes?: readonly AccountTokenPurpose[],
): Promise<number> {
  const rows = await db
    .update(accountToken)
    .set({ usedAt: now, modifiedAt: now })
    .where(
      and(
        eq(accountToken.accountId, accountId),
        isNull(accountToken.usedAt),
        purposes === undefined ? undefined : inArray(accountToken.purpose, [...purposes]),
      ),
    )
    .returning({ id: accountToken.id })
  return rows.length
}

export interface TokenWithAccount {
  readonly id: string
  readonly purpose: string
  readonly newEmail: string | null
  readonly expiresAt: Date
  readonly usedAt: Date | null
  readonly accountId: string
  readonly accountUsername: string
  readonly accountEmail: string
  readonly accountStatus: string
}

/**
 * The link behind a token hash, with its account, locked for the rest of the transaction so that two requests with the
 * same link cannot both pass. Nothing is judged here: the caller checks purpose, expiry and use.
 */
export async function findTokenForUpdate(db: Executor, tokenHash: string): Promise<TokenWithAccount | undefined> {
  const rows = await db
    .select({
      id: accountToken.id,
      purpose: accountToken.purpose,
      newEmail: accountToken.newEmail,
      expiresAt: accountToken.expiresAt,
      usedAt: accountToken.usedAt,
      accountId: account.id,
      accountUsername: account.username,
      accountEmail: account.email,
      accountStatus: account.status,
    })
    .from(accountToken)
    .innerJoin(account, eq(account.id, accountToken.accountId))
    .where(eq(accountToken.tokenHash, tokenHash))
    .limit(1)
    .for('update', { of: accountToken })
  return rows[0]
}

/** Marks a link used. False when it was used already, which cannot happen after `findTokenForUpdate` but fails closed. */
export async function markTokenUsed(db: Executor, tokenId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(accountToken)
    .set({ usedAt: now, modifiedAt: now })
    .where(and(eq(accountToken.id, tokenId), isNull(accountToken.usedAt)))
    .returning({ id: accountToken.id })
  return rows.length === 1
}

/** The address and expiry of the account's newest unused, unexpired e-mail change link, or undefined. The token hash is not read. */
export async function findPendingEmailChange(
  db: Executor,
  accountId: string,
  now: Date,
): Promise<{ readonly email: string; readonly expiresAt: Date } | undefined> {
  const rows = await db
    .select({ email: accountToken.newEmail, expiresAt: accountToken.expiresAt })
    .from(accountToken)
    .where(
      and(
        eq(accountToken.accountId, accountId),
        eq(accountToken.purpose, 'email_change'),
        isNull(accountToken.usedAt),
        gt(accountToken.expiresAt, now),
      ),
    )
    .orderBy(desc(accountToken.createdAt), desc(accountToken.id))
    .limit(1)
  const row = rows[0]
  return row?.email == null ? undefined : { email: row.email, expiresAt: row.expiresAt }
}

/** Uses up every unused link for a new administrator address, whoever asked for it: only the last request counts (K-192). */
export async function invalidateAdminEmailTokens(db: Executor, now: Date): Promise<void> {
  await db
    .update(accountToken)
    .set({ usedAt: now, modifiedAt: now })
    .where(and(eq(accountToken.purpose, 'admin_email_change'), isNull(accountToken.usedAt)))
}

/** The administrator address waiting for its confirmation, if a link for one is still good. */
export async function pendingAdminEmail(db: Executor, now: Date): Promise<string | undefined> {
  const rows = await db
    .select({ newEmail: accountToken.newEmail })
    .from(accountToken)
    .where(
      and(eq(accountToken.purpose, 'admin_email_change'), isNull(accountToken.usedAt), gt(accountToken.expiresAt, now)),
    )
    .orderBy(desc(accountToken.createdAt))
    .limit(1)
  return rows[0]?.newEmail ?? undefined
}
