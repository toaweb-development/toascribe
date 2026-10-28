// The users list and the role assignment of M0.5 (typescript §8). Reads `account`, `role`, `account_role` and the author links
// of posts; writes only `account_role`.
import { schema } from '@toascribe/db'
import { NO_ROLE_FILTER } from '@toascribe/shared'
import type { SortOrder, UserListOrderBy } from '@toascribe/shared'
import { and, asc, count, countDistinct, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Executor } from './executor.ts'

const { account, accountRole, content, contentAuthor, role } = schema

/** Escapes the characters LIKE treats as wildcards, and the escape character itself (PostgreSQL's default is `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export interface UserFilter {
  /** Already trimmed; empty means no search. */
  readonly search: string | undefined
  /** A role slug, or `none` for accounts without a role. */
  readonly role: string | undefined
}

export interface UserRow {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly email: string
  readonly status: string
  readonly createdAt: Date
  /** The stored profile, for the profile picture (M1.8). */
  readonly profile: unknown
}

function filterCondition(filter: UserFilter): SQL | undefined {
  const conditions: SQL[] = []
  if (filter.search !== undefined && filter.search !== '') {
    const pattern = `%${escapeLike(filter.search)}%`
    const match = or(
      sql`${account.username} ilike ${pattern}`,
      sql`${account.email} ilike ${pattern}`,
      sql`${account.displayName} ilike ${pattern}`,
      sql`${account.nicename} ilike ${pattern}`,
    )
    if (match !== undefined) {
      conditions.push(match)
    }
  }
  if (filter.role === NO_ROLE_FILTER) {
    conditions.push(sql`not exists (select 1 from ${accountRole} where ${accountRole.accountId} = ${account.id})`)
  } else if (filter.role !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${accountRole} inner join ${role} on ${role.id} = ${accountRole.roleId}
        where ${accountRole.accountId} = ${account.id} and ${role.slug} = ${filter.role})`,
    )
  }
  return conditions.length === 0 ? undefined : and(...conditions)
}

function orderColumn(orderby: UserListOrderBy): SQL {
  switch (orderby) {
    case 'username':
      return sql`lower(${account.username})`
    case 'name':
      return sql`lower(${account.displayName})`
    case 'email':
      return sql`lower(${account.email})`
    case 'registered':
      return sql`${account.createdAt}`
    default:
      return orderby satisfies never
  }
}

/** One page of accounts matching the filter. Ties are broken by id so that a page does not shift between requests. */
export function listAccountPage(
  db: Executor,
  filter: UserFilter,
  orderby: UserListOrderBy,
  order: SortOrder,
  limit: number,
  offset: number,
): Promise<UserRow[]> {
  const direction = order === 'asc' ? asc : desc
  return db
    .select({
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      email: account.email,
      status: account.status,
      createdAt: account.createdAt,
      profile: account.profile,
    })
    .from(account)
    .where(filterCondition(filter))
    .orderBy(direction(orderColumn(orderby)), direction(account.id))
    .limit(limit)
    .offset(offset)
}

/** How many accounts match the filter, over all pages. */
export async function countAccounts(db: Executor, filter: UserFilter): Promise<number> {
  const rows = await db.select({ n: count() }).from(account).where(filterCondition(filter))
  return rows[0]?.n ?? 0
}

/** The role slugs of each of these accounts, sorted. An account without a role is not in the map. */
export async function roleSlugsOf(db: Executor, accountIds: readonly string[]): Promise<Map<string, string[]>> {
  const slugs = new Map<string, string[]>()
  if (accountIds.length === 0) {
    return slugs
  }
  const rows = await db
    .select({ accountId: accountRole.accountId, slug: role.slug })
    .from(accountRole)
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(inArray(accountRole.accountId, [...accountIds]))
    .orderBy(role.slug)
  for (const row of rows) {
    slugs.set(row.accountId, [...(slugs.get(row.accountId) ?? []), row.slug])
  }
  return slugs
}

/** Published posts each of these accounts is an author of (WordPress' «Innlegg» column). An account with none is not in the map. */
export async function publishedPostCounts(db: Executor, accountIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (accountIds.length === 0) {
    return counts
  }
  const rows = await db
    .select({ accountId: contentAuthor.accountId, n: count() })
    .from(contentAuthor)
    .innerJoin(content, eq(content.id, contentAuthor.contentId))
    .where(
      and(inArray(contentAuthor.accountId, [...accountIds]), eq(content.type, 'post'), eq(content.status, 'publish')),
    )
    .groupBy(contentAuthor.accountId)
  for (const row of rows) {
    counts.set(row.accountId, row.n)
  }
  return counts
}

export interface RoleCounts {
  readonly all: number
  readonly none: number
  readonly roles: Record<string, number>
}

/** The views above the table: every account, those without a role, and the holders of each role. Independent of any filter. */
export async function countByRole(db: Executor): Promise<RoleCounts> {
  const [all, none, held] = await Promise.all([
    countAccounts(db, { search: undefined, role: undefined }),
    countAccounts(db, { search: undefined, role: NO_ROLE_FILTER }),
    db
      .select({ slug: role.slug, n: countDistinct(accountRole.accountId) })
      .from(accountRole)
      .innerJoin(role, eq(role.id, accountRole.roleId))
      .groupBy(role.slug),
  ])
  // fromEntries defines own keys, so a role slug such as `__proto__` is only a key.
  const roles: Record<string, number> = Object.fromEntries(held.map((row) => [row.slug, row.n]))
  return { all, none, roles }
}

export interface RoleRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly capabilities: readonly string[]
}

export function listRoles(db: Executor): Promise<RoleRow[]> {
  return db.select({ id: role.id, slug: role.slug, name: role.name, capabilities: role.capabilities }).from(role)
}

export async function findRoleBySlug(db: Executor, slug: string): Promise<RoleRow | undefined> {
  const rows = await db
    .select({ id: role.id, slug: role.slug, name: role.name, capabilities: role.capabilities })
    .from(role)
    .where(eq(role.slug, slug))
    .limit(1)
  return rows[0]
}

/**
 * Serialises every change of who holds a role until the end of the transaction. The rule «never leave the site without an
 * active administrator» reads the administrators and then writes; two requests that each demote a different one of two would
 * both see two, so the read and the write of one must not interleave with another's. A flow that later removes or disables an
 * administrator in another way must take this lock too. Only meaningful inside a transaction.
 */
export async function lockRoleChanges(db: Executor): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended('toascribe:role-assignment', 0))`)
}

export interface TargetAccount {
  readonly id: string
  readonly username: string
  readonly status: string
  /** Role slugs, sorted. */
  readonly roles: readonly string[]
  /** The union of the capabilities of all the roles. */
  readonly capabilities: ReadonlySet<string>
}

/** The accounts that exist among `ids`, with their roles and capabilities. A deleted or unknown id is not in the map. */
export async function loadTargets(db: Executor, ids: readonly string[]): Promise<Map<string, TargetAccount>> {
  const accounts = await db
    .select({ id: account.id, username: account.username, status: account.status })
    .from(account)
    .where(inArray(account.id, [...ids]))
  const grants = await db
    .select({ accountId: accountRole.accountId, slug: role.slug, capabilities: role.capabilities })
    .from(accountRole)
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(inArray(accountRole.accountId, [...ids]))
    .orderBy(role.slug)
  const targets = new Map<string, TargetAccount>()
  for (const row of accounts) {
    const own = grants.filter((grant) => grant.accountId === row.id)
    targets.set(row.id, {
      ...row,
      roles: own.map((grant) => grant.slug),
      capabilities: new Set(own.flatMap((grant) => grant.capabilities)),
    })
  }
  return targets
}

/** The ids of the active accounts that hold the administrator role. */
export async function listActiveAdministratorIds(db: Executor): Promise<string[]> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .innerJoin(accountRole, eq(accountRole.accountId, account.id))
    .innerJoin(role, eq(role.id, accountRole.roleId))
    .where(and(eq(role.slug, 'administrator'), eq(account.status, 'active')))
  return rows.map((row) => row.id)
}

/** Replaces all the roles of an account with one. */
export async function replaceRoles(db: Executor, accountId: string, roleId: string, now: Date): Promise<void> {
  await db.delete(accountRole).where(eq(accountRole.accountId, accountId))
  await db.insert(accountRole).values({ accountId, roleId, createdAt: now })
}
