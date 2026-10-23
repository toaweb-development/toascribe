// The queries of the user commands. The cli has no api to call, so it reads and writes the few tables itself, as the app role
// (DML only). The rules are the api's: usernames, e-mail addresses and URL names are unique without regard to case.
import { schema } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { CoreSettings } from '@toascribe/shared'
import type { AuditSource, JsonValue } from '@toascribe/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'

const {
  account,
  accountRole,
  accountToken,
  auditLog,
  loginAttempt,
  mfaCredential,
  recoveryCode,
  role,
  session,
  setting,
} = schema

/** The database, or the transaction a command opened. */
export type Executor = Parameters<Parameters<Database['transaction']>[0]>[0] | Database

/** The PostgreSQL error behind an error from the driver or from Drizzle (which wraps it in `cause`), if there is one. */
function postgresError(err: unknown): { code?: unknown; constraint?: unknown } | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

/** The name of the unique constraint a statement broke (SQLSTATE 23505), or undefined for any other error. */
export function uniqueViolation(err: unknown): string | undefined {
  const found = postgresError(err)
  if (found?.code !== '23505') {
    return undefined
  }
  return typeof found.constraint === 'string' ? found.constraint : ''
}

export interface RoleRecord {
  readonly id: string
  readonly slug: string
}

export async function findRole(db: Executor, slug: string): Promise<RoleRecord | undefined> {
  const rows = await db.select({ id: role.id, slug: role.slug }).from(role).where(eq(role.slug, slug)).limit(1)
  return rows[0]
}

export async function listRoleSlugs(db: Executor): Promise<string[]> {
  const rows = await db.select({ slug: role.slug }).from(role).orderBy(role.slug)
  return rows.map((row) => row.slug)
}

export interface Taken {
  readonly username: boolean
  readonly email: boolean
}

/** Whether an account already has this username or this e-mail address, compared without regard to case. */
export async function findTaken(db: Executor, username: string, email: string): Promise<Taken> {
  const rows = await db
    .select({ username: account.username, email: account.email })
    .from(account)
    .where(sql`lower(${account.username}) = lower(${username}) or lower(${account.email}) = lower(${email})`)
    .limit(2)
  return {
    username: rows.some((row) => row.username.toLowerCase() === username.toLowerCase()),
    email: rows.some((row) => row.email.toLowerCase() === email.toLowerCase()),
  }
}

/** The URL name of the author archive, as the api makes it from a username (`nicenameFor` in apps/api). */
export function nicenameFor(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'user' : slug
}

/** The first of `base`, `base-2`, `base-3`, ... that no account has as its nicename. */
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
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export interface NewAccount {
  readonly username: string
  readonly email: string
  readonly displayName: string
  readonly nicename: string
  /** Null for an account that is to choose its own password with a one-time link (status `pending`). */
  readonly passwordHash: string | null
  readonly status: 'active' | 'pending'
  readonly roleId: string
  readonly now: Date
}

/** Inserts an account with its role. A name or address that is already taken makes PostgreSQL refuse (23505). */
export async function insertAccountWithRole(db: Executor, input: NewAccount): Promise<string> {
  const rows = await db
    .insert(account)
    .values({
      username: input.username,
      email: input.email,
      displayName: input.displayName,
      nicename: input.nicename,
      passwordHash: input.passwordHash,
      status: input.status,
      createdAt: input.now,
      modifiedAt: input.now,
    })
    .returning({ id: account.id })
  const row = rows[0]
  if (row === undefined) {
    throw new Error('the account insert returned no row')
  }
  await db.insert(accountRole).values({ accountId: row.id, roleId: input.roleId, createdAt: input.now })
  return row.id
}

export interface AccountToReset {
  readonly id: string
  readonly username: string
  readonly email: string
  readonly status: string
}

export type AccountSelector = { readonly username: string } | { readonly email: string }

/** The account a username or an e-mail address belongs to (case-insensitive), locked for the rest of the transaction. */
export async function lockAccount(db: Executor, selector: AccountSelector): Promise<AccountToReset | undefined> {
  const where =
    'username' in selector
      ? sql`lower(${account.username}) = lower(${selector.username})`
      : sql`lower(${account.email}) = lower(${selector.email})`
  const rows = await db
    .select({ id: account.id, username: account.username, email: account.email, status: account.status })
    .from(account)
    .where(where)
    .limit(1)
    .for('update')
  return rows[0]
}

export async function setPasswordHash(db: Executor, accountId: string, passwordHash: string, now: Date): Promise<void> {
  await db.update(account).set({ passwordHash, modifiedAt: now }).where(eq(account.id, accountId))
}

/** Deletes every session of the account: it is signed out everywhere. Returns how many there were. */
export async function deleteSessions(db: Executor, accountId: string): Promise<number> {
  const rows = await db.delete(session).where(eq(session.accountId, accountId)).returning({ id: session.id })
  return rows.length
}

/** Deletes every row of `mfa_credential` of the account (confirmed or not, any type). Returns how many there were of each type. */
export async function deleteMfaCredentials(db: Executor, accountId: string): Promise<Record<string, number>> {
  const rows = await db
    .delete(mfaCredential)
    .where(eq(mfaCredential.accountId, accountId))
    .returning({ type: mfaCredential.type })
  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.type] = (counts[row.type] ?? 0) + 1
  }
  return counts
}

/** Deletes every recovery code of the account, used or not. Returns how many there were. */
export async function deleteRecoveryCodes(db: Executor, accountId: string): Promise<number> {
  const rows = await db
    .delete(recoveryCode)
    .where(eq(recoveryCode.accountId, accountId))
    .returning({ id: recoveryCode.id })
  return rows.length
}

/**
 * The slugs of the account's roles that `mfa_required_roles` names: the roles that make the next login an enrolment. The
 * setting is read as the api reads it: a missing or invalid value is the default (none).
 */
export async function rolesRequiringMfa(db: Executor, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ value: setting.value })
    .from(setting)
    .where(eq(setting.key, 'mfa_required_roles'))
    .limit(1)
  const parsed = CoreSettings.shape.mfa_required_roles.safeParse(rows[0]?.value)
  const required = parsed.success ? parsed.data : []
  if (required.length === 0) {
    return []
  }
  const held = await db
    .select({ slug: role.slug })
    .from(accountRole)
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(eq(accountRole.accountId, accountId))
    .orderBy(role.slug)
  return held.map((row) => row.slug).filter((slug) => required.includes(slug))
}

/** Uses up the account's unused one-time links (lost password, welcome, e-mail change), as a password reset in the api does. */
export async function voidUnusedLinks(db: Executor, accountId: string, now: Date): Promise<number> {
  const rows = await db
    .update(accountToken)
    .set({ usedAt: now, modifiedAt: now })
    .where(and(eq(accountToken.accountId, accountId), isNull(accountToken.usedAt)))
    .returning({ id: accountToken.id })
  return rows.length
}

/**
 * Stores a one-time link to choose the first password (`set_password`, as registration makes one): only the token's hash is
 * kept. The caller mails the token, which is shown nowhere else.
 */
export async function insertSetPasswordLink(
  db: Executor,
  input: { readonly accountId: string; readonly tokenHash: string; readonly expiresAt: Date; readonly now: Date },
): Promise<void> {
  await db.insert(accountToken).values({
    accountId: input.accountId,
    purpose: 'set_password',
    tokenHash: input.tokenHash,
    newEmail: null,
    expiresAt: input.expiresAt,
    createdAt: input.now,
    modifiedAt: input.now,
  })
}

export interface AuditInput {
  /** The account the entry is about. */
  readonly accountId: string
  readonly action: string
  readonly newValue?: JsonValue
}

/** The audit entry of a command: a system actor named `cli`, source `cli`, no client address. */
export async function insertCliAudit(db: Executor, input: AuditInput, now: Date): Promise<void> {
  const source: AuditSource = 'cli'
  await db.insert(auditLog).values({
    actorType: 'system',
    actor: 'cli',
    accountId: input.accountId,
    action: input.action,
    objectType: 'account',
    objectId: input.accountId,
    newValue: input.newValue ?? null,
    source,
    ip: null,
    createdAt: now,
  })
}

/** The rate-limited actions of `login_attempt` (LOGIN_ATTEMPT_ACTION in @toascribe/shared) that are about one account's credentials. */
export type ClearedAction = 'login' | 'mfa' | 'password_lost' | 'register'

/**
 * Ends the streak of failures the api counts against an account, for each action: one succeeded row per action (the table is
 * append-only, as the api's own reset does it). The address is the «unknown» one: successes are not counted against an address.
 */
export async function clearLoginAttempts(
  db: Executor,
  accountId: string,
  actions: readonly ClearedAction[],
  now: Date,
): Promise<void> {
  await db
    .insert(loginAttempt)
    .values(actions.map((action) => ({ action, ip: '0.0.0.0', accountId, succeeded: true, createdAt: now })))
}
