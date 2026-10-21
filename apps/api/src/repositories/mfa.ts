// The only place that reads and writes `mfa_credential` and `recovery_code` (typescript §8). Only TOTP is handled here; passkeys
// and OIDC identities (phase 2) share the table and are never returned by these queries.
import { schema } from '@toascribe/db'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { mfaCredential, recoveryCode } = schema

export interface TotpFactor {
  readonly id: string
  readonly name: string | null
  readonly createdAt: Date
  readonly lastUsedAt: Date | null
}

export interface TotpCredential extends TotpFactor {
  readonly secretEncrypted: string
}

const factorColumns = {
  id: mfaCredential.id,
  name: mfaCredential.name,
  createdAt: mfaCredential.createdAt,
  lastUsedAt: mfaCredential.lastUsedAt,
} as const

const credentialColumns = { ...factorColumns, secretEncrypted: mfaCredential.secretEncrypted } as const

/** The enrolled factors (the first code was accepted), oldest first. */
export function listConfirmedFactors(db: Executor, accountId: string): Promise<TotpFactor[]> {
  return db
    .select(factorColumns)
    .from(mfaCredential)
    .where(
      and(eq(mfaCredential.accountId, accountId), eq(mfaCredential.type, 'totp'), isNotNull(mfaCredential.confirmedAt)),
    )
    .orderBy(asc(mfaCredential.createdAt), asc(mfaCredential.id))
}

/** The enrolled factors with their encrypted secrets, for checking a code. */
export async function listConfirmedCredentials(db: Executor, accountId: string): Promise<TotpCredential[]> {
  const rows = await db
    .select(credentialColumns)
    .from(mfaCredential)
    .where(
      and(eq(mfaCredential.accountId, accountId), eq(mfaCredential.type, 'totp'), isNotNull(mfaCredential.confirmedAt)),
    )
    .orderBy(asc(mfaCredential.createdAt), asc(mfaCredential.id))
  return rows.flatMap((row) => (row.secretEncrypted === null ? [] : [{ ...row, secretEncrypted: row.secretEncrypted }]))
}

/** One enrolled factor of this account. */
export async function findConfirmedFactor(
  db: Executor,
  accountId: string,
  credentialId: string,
): Promise<TotpFactor | undefined> {
  const rows = await db
    .select(factorColumns)
    .from(mfaCredential)
    .where(
      and(
        eq(mfaCredential.id, credentialId),
        eq(mfaCredential.accountId, accountId),
        eq(mfaCredential.type, 'totp'),
        isNotNull(mfaCredential.confirmedAt),
      ),
    )
    .limit(1)
  return rows[0]
}

/** A factor of this account whose enrolment is not finished. The account is part of the query (security §2, BOLA). */
export async function findUnconfirmedCredential(
  db: Executor,
  accountId: string,
  credentialId: string,
): Promise<TotpCredential | undefined> {
  const rows = await db
    .select(credentialColumns)
    .from(mfaCredential)
    .where(
      and(
        eq(mfaCredential.id, credentialId),
        eq(mfaCredential.accountId, accountId),
        eq(mfaCredential.type, 'totp'),
        isNull(mfaCredential.confirmedAt),
      ),
    )
    .limit(1)
  const row = rows[0]
  return row === undefined || row.secretEncrypted === null
    ? undefined
    : { ...row, secretEncrypted: row.secretEncrypted }
}

export async function countConfirmedFactors(db: Executor, accountId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mfaCredential)
    .where(
      and(eq(mfaCredential.accountId, accountId), eq(mfaCredential.type, 'totp'), isNotNull(mfaCredential.confirmedAt)),
    )
  return rows[0]?.count ?? 0
}

/** Removes the account's unfinished enrolments: a new start replaces the old one, so there is never more than one. */
export async function deleteUnconfirmedCredentials(db: Executor, accountId: string): Promise<void> {
  await db
    .delete(mfaCredential)
    .where(
      and(eq(mfaCredential.accountId, accountId), eq(mfaCredential.type, 'totp'), isNull(mfaCredential.confirmedAt)),
    )
}

export async function insertUnconfirmedCredential(
  db: Executor,
  input: {
    readonly id: string
    readonly accountId: string
    readonly name: string | null
    readonly secretEncrypted: string
    readonly now: Date
  },
): Promise<void> {
  await db.insert(mfaCredential).values({
    id: input.id,
    accountId: input.accountId,
    type: 'totp',
    name: input.name,
    secretEncrypted: input.secretEncrypted,
    confirmedAt: null,
    createdAt: input.now,
    modifiedAt: input.now,
  })
}

/** Finishes enrolment. False when it was finished already (or the row is gone). */
export async function confirmCredential(db: Executor, credentialId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(mfaCredential)
    .set({ confirmedAt: now, modifiedAt: now })
    .where(and(eq(mfaCredential.id, credentialId), isNull(mfaCredential.confirmedAt)))
    .returning({ id: mfaCredential.id })
  return rows.length === 1
}

/**
 * Records that the code of time step `step` was accepted, if no code of this step or a later one was accepted before. The
 * comparison is part of the UPDATE, so two requests with the same code cannot both win: one gets false, and that is a
 * replay (RFC 6238 §5.2). The step is kept in `data.lastStep`.
 */
export async function recordTotpStep(db: Executor, credentialId: string, step: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(mfaCredential)
    .set({
      data: sql`jsonb_set(${mfaCredential.data}, '{lastStep}', to_jsonb(${step}::bigint))`,
      lastUsedAt: now,
      modifiedAt: now,
    })
    .where(
      and(
        eq(mfaCredential.id, credentialId),
        sql`coalesce((${mfaCredential.data} ->> 'lastStep')::bigint, -1) < ${step}::bigint`,
      ),
    )
    .returning({ id: mfaCredential.id })
  return rows.length === 1
}

/** Removes one enrolled factor of this account. False when the account has no such factor. */
export async function deleteConfirmedFactor(db: Executor, accountId: string, credentialId: string): Promise<boolean> {
  const rows = await db
    .delete(mfaCredential)
    .where(
      and(
        eq(mfaCredential.id, credentialId),
        eq(mfaCredential.accountId, accountId),
        eq(mfaCredential.type, 'totp'),
        isNotNull(mfaCredential.confirmedAt),
      ),
    )
    .returning({ id: mfaCredential.id })
  return rows.length === 1
}

// ── Recovery codes ──────────────────────────────────────────

/** Whether the account has ever been given recovery codes (used or not) and still has the rows. */
export async function hasRecoveryCodeRows(db: Executor, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: recoveryCode.id })
    .from(recoveryCode)
    .where(eq(recoveryCode.accountId, accountId))
    .limit(1)
  return rows.length > 0
}

export async function countUnusedRecoveryCodes(db: Executor, accountId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recoveryCode)
    .where(and(eq(recoveryCode.accountId, accountId), isNull(recoveryCode.usedAt)))
  return rows[0]?.count ?? 0
}

/** Replaces all the account's recovery codes (used ones too) with these hashes. */
export async function replaceRecoveryCodes(
  db: Executor,
  accountId: string,
  codeHashes: readonly string[],
  now: Date,
): Promise<void> {
  await db.delete(recoveryCode).where(eq(recoveryCode.accountId, accountId))
  if (codeHashes.length > 0) {
    await db
      .insert(recoveryCode)
      .values(codeHashes.map((codeHash) => ({ accountId, codeHash, createdAt: now, modifiedAt: now })))
  }
}

export async function deleteRecoveryCodes(db: Executor, accountId: string): Promise<void> {
  await db.delete(recoveryCode).where(eq(recoveryCode.accountId, accountId))
}

/** Uses up a recovery code. True only for the one request that flips `used_at` from null (a code works once). */
export async function useRecoveryCode(db: Executor, accountId: string, codeHash: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(recoveryCode)
    .set({ usedAt: now, modifiedAt: now })
    .where(and(eq(recoveryCode.accountId, accountId), eq(recoveryCode.codeHash, codeHash), isNull(recoveryCode.usedAt)))
    .returning({ id: recoveryCode.id })
  return rows.length === 1
}
