// The only place that reads and writes `account`, `role` and `account_role` for the auth flows (typescript §8).
import { schema } from '@toascribe/db'
import type { ProfileFields } from '@toascribe/shared'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'

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

/** The hash of the account's password, or null when it has none (a registered account that has not chosen one yet). */
export async function findPasswordHash(db: Executor, accountId: string): Promise<string | null> {
  const rows = await db
    .select({ passwordHash: account.passwordHash })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)
  return rows[0]?.passwordHash ?? null
}

/** The accounts that have this username or this e-mail address, compared without regard to case. At most two. */
export function findAccountsByUsernameOrEmail(db: Executor, username: string, email: string): Promise<AccountView[]> {
  return db
    .select(accountViewColumns)
    .from(account)
    .where(sql`lower(${account.username}) = lower(${username}) or lower(${account.email}) = lower(${email})`)
    .limit(2)
}

/** Whether another account than `exceptAccountId` has this e-mail address. */
export async function emailInUse(db: Executor, email: string, exceptAccountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(sql`lower(${account.email}) = lower(${email}) and ${account.id} <> ${exceptAccountId}`)
    .limit(1)
  return rows.length > 0
}

/** The account that has this e-mail address, if any. */
export async function findAccountByEmail(db: Executor, email: string): Promise<AccountView | undefined> {
  const rows = await db
    .select(accountViewColumns)
    .from(account)
    .where(sql`lower(${account.email}) = lower(${email})`)
    .limit(1)
  return rows[0]
}

/** The first of `base`, `base-2`, `base-3`, ... that no account has as its nicename (the URL part of the author archive). */
export async function freeNicename(db: Executor, base: string): Promise<string> {
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${String(n)}`
    const rows = await db
      .select({ id: account.id })
      .from(account)
      .where(sql`lower(${account.nicename}) = lower(${candidate})`)
      .limit(1)
    if (rows.length === 0) {
      return candidate
    }
  }
  // Fifty accounts of the same name: let the unique index decide with a random tail.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export interface NewAccount {
  readonly username: string
  readonly email: string
  readonly nicename: string
  readonly status: 'pending' | 'active'
  readonly now: Date
}

/** Inserts an account without a password. A name or address that is already taken makes PostgreSQL refuse (23505). */
export async function insertAccount(db: Executor, input: NewAccount): Promise<string> {
  const rows = await db
    .insert(account)
    .values({
      username: input.username,
      email: input.email,
      displayName: input.username,
      nicename: input.nicename,
      passwordHash: null,
      status: input.status,
      createdAt: input.now,
      modifiedAt: input.now,
    })
    .returning({ id: account.id })
  const row = rows[0]
  if (row === undefined) {
    throw new Error('the account insert returned no row')
  }
  return row.id
}

export interface RoleRecord {
  readonly id: string
  readonly slug: string
  readonly capabilities: readonly string[]
}

export async function findRoleBySlug(db: Executor, slug: string): Promise<RoleRecord | undefined> {
  const rows = await db
    .select({ id: role.id, slug: role.slug, capabilities: role.capabilities })
    .from(role)
    .where(eq(role.slug, slug))
    .limit(1)
  return rows[0]
}

export async function grantRole(db: Executor, accountId: string, roleId: string, now: Date): Promise<void> {
  await db.insert(accountRole).values({ accountId, roleId, createdAt: now })
}

/**
 * Stores a new password hash after a reset or a first choice, and makes the account active (it proved that it owns the
 * address by opening the link). A disabled account is not touched; the caller has already refused it.
 */
export async function setPasswordAndActivate(
  db: Executor,
  accountId: string,
  passwordHash: string,
  now: Date,
): Promise<void> {
  await db
    .update(account)
    .set({ passwordHash, status: 'active', modifiedAt: now })
    .where(and(eq(account.id, accountId), ne(account.status, 'disabled')))
}

/** Stores a new password hash for an account that is signed in and knows the old one. */
export async function setPassword(db: Executor, accountId: string, passwordHash: string, now: Date): Promise<void> {
  await db.update(account).set({ passwordHash, modifiedAt: now }).where(eq(account.id, accountId))
}

/** Replaces the e-mail address. A taken address makes PostgreSQL refuse (23505). */
export async function setEmail(db: Executor, accountId: string, email: string, now: Date): Promise<void> {
  await db.update(account).set({ email, modifiedAt: now }).where(eq(account.id, accountId))
}

export interface AdminRecipient {
  readonly id: string
  readonly username: string
  readonly email: string
}

/** The active accounts with the administrator role: who gets the notices of K-017. */
export function listAdministrators(db: Executor): Promise<AdminRecipient[]> {
  return db
    .select({ id: account.id, username: account.username, email: account.email })
    .from(account)
    .innerJoin(accountRole, eq(accountRole.accountId, account.id))
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(and(eq(role.slug, 'administrator'), eq(account.status, 'active')))
    .orderBy(account.username)
}
