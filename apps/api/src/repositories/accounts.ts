// The only place that reads and writes `account`, `role` and `account_role` for the auth flows (typescript §8).
import { schema } from '@toascribe/db'
import type { ProfileFields } from '@toascribe/shared'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { account, accountRole, mfaCredential, role } = schema

/** An account without its password hash: what the rest of the api gets to see. */
export interface AccountView {
  readonly id: string
  readonly username: string
  readonly email: string
  readonly displayName: string
  readonly status: string
  readonly locale: string | null
  readonly profile: Record<string, unknown>
}

/** An account with the hash. Only the login flow reads it. */
export interface AccountForLogin extends AccountView {
  readonly passwordHash: string | null
}

export const accountViewColumns = {
  id: account.id,
  username: account.username,
  email: account.email,
  displayName: account.displayName,
  status: account.status,
  locale: account.locale,
  profile: account.profile,
} as const

const accountLoginColumns = { ...accountViewColumns, passwordHash: account.passwordHash } as const

/**
 * The account a login name belongs to. It is a username or an e-mail address, compared without regard to case as
 * WordPress does. If one account's username equals another's e-mail address, the username wins.
 */
export async function findAccountByLogin(db: Executor, login: string): Promise<AccountForLogin | undefined> {
  const rows = await db
    .select(accountLoginColumns)
    .from(account)
    .where(sql`lower(${account.username}) = lower(${login}) or lower(${account.email}) = lower(${login})`)
    .orderBy(sql`(lower(${account.username}) = lower(${login})) desc`)
    .limit(1)
  return rows[0]
}

export async function findAccountById(db: Executor, id: string): Promise<AccountView | undefined> {
  const rows = await db.select(accountViewColumns).from(account).where(eq(account.id, id)).limit(1)
  return rows[0]
}

export interface RoleGrant {
  readonly slug: string
  readonly capabilities: readonly string[]
}

/** The roles an account holds with their capabilities. Read on every request, so a change takes effect at once. */
export function listRoleGrants(db: Executor, accountId: string): Promise<RoleGrant[]> {
  return db
    .select({ slug: role.slug, capabilities: role.capabilities })
    .from(accountRole)
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(eq(accountRole.accountId, accountId))
    .orderBy(role.slug)
}

/** True when the account has a second factor that finished enrolment (`confirmed_at` set). */
export async function hasConfirmedMfaFactor(db: Executor, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: mfaCredential.id })
    .from(mfaCredential)
    .where(and(eq(mfaCredential.accountId, accountId), isNotNull(mfaCredential.confirmedAt)))
    .limit(1)
  return rows.length > 0
}

/** Stores a new password hash (the upgrade of an imported hash). */
export async function setPasswordHash(db: Executor, accountId: string, passwordHash: string, now: Date): Promise<void> {
  await db.update(account).set({ passwordHash, modifiedAt: now }).where(eq(account.id, accountId))
}

/**
 * Stores the profile and the display name built from it. The caller passes the whole new profile; the JSON keeps exactly
 * the keys of ProfileFields.
 */
export async function updateProfile(
  db: Executor,
  accountId: string,
  displayName: string,
  profile: ProfileFields,
  now: Date,
): Promise<void> {
  await db.update(account).set({ displayName, profile, modifiedAt: now }).where(eq(account.id, accountId))
}
