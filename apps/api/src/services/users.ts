// The users list and role assignment (M0.5; WordPress' users.php). Capabilities are read from the database on every request
// (SessionService.authenticate), so a role change reaches the changed account's open sessions at their next request.
import type { Database } from '@toascribe/db'
import type {
  AssignRoleRequest,
  AssignRoleResponse,
  AssignRoleSkipReason,
  UserListItem,
  UserListQuery,
  UserListResponse,
  UserRoleOption,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { AppError, ForbiddenError } from '../lib/errors.ts'
import { listRoleGrants } from '../repositories/accounts.ts'
import { inTransaction } from '../repositories/executor.ts'
import {
  countAccounts,
  countByRole,
  findRoleBySlug,
  listAccountPage,
  listActiveAdministratorIds,
  listRoles,
  loadTargets,
  lockRoleChanges,
  publishedPostCounts,
  replaceRoles,
  roleSlugsOf,
} from '../repositories/users.ts'
import type { Auditor, RequestContext } from './support.ts'

export interface UserService {
  /** One page of the users table with the views and the roles to filter and assign by. */
  list: (auth: SessionAuth, query: UserListQuery) => Promise<UserListResponse>
  /**
   * Replaces the roles of the accounts with one role, in one transaction, one audit entry per changed account. An account that
   * cannot be changed is left out and named with its reason; an unknown role is a 400 and a role the caller may not give a 403,
   * both for the whole request.
   */
  assignRole: (auth: SessionAuth, request: AssignRoleRequest, ctx: RequestContext) => Promise<AssignRoleResponse>
}

/** WordPress lists the five built-in roles in this order, and the others after them. */
const ROLE_ORDER: readonly string[] = ['administrator', 'editor', 'author', 'contributor', 'subscriber']

function compareRoles(a: { slug: string; name: string }, b: { slug: string; name: string }): number {
  const rankA = ROLE_ORDER.indexOf(a.slug)
  const rankB = ROLE_ORDER.indexOf(b.slug)
  if (rankA !== -1 || rankB !== -1) {
    return (rankA === -1 ? ROLE_ORDER.length : rankA) - (rankB === -1 ? ROLE_ORDER.length : rankB)
  }
  return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
}

/** WordPress' `editable_roles`, as capabilities: `held` covers `needed` when it holds every one of them. */
export function covers(held: ReadonlySet<string>, needed: Iterable<string>): boolean {
  for (const capability of needed) {
    if (!held.has(capability)) {
      return false
    }
  }
  return true
}

export function createUserService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
}): UserService {
  const { db, clock, audit } = options

  return {
    async list(auth, query) {
      const filter = { search: query.search, role: query.role }
      const [rows, total, roleCounts, roleRows] = await Promise.all([
        listAccountPage(db, filter, query.orderby, query.order, query.perPage, (query.page - 1) * query.perPage),
        countAccounts(db, filter),
        countByRole(db),
        listRoles(db),
      ])
      const ids = rows.map((row) => row.id)
      const [roles, posts] = await Promise.all([roleSlugsOf(db, ids), publishedPostCounts(db, ids)])
      const users: UserListItem[] = rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        email: row.email,
        roles: roles.get(row.id) ?? [],
        // The column is checked against ACCOUNT_STATUS in the database.
        status: row.status as UserListItem['status'],
        registeredAt: row.createdAt.toISOString(),
        postCount: posts.get(row.id) ?? 0,
      }))
      const options: UserRoleOption[] = roleRows
        .map((row) => ({ slug: row.slug, name: row.name, grantable: covers(auth.capabilities, row.capabilities) }))
        .sort(compareRoles)
      return { users, total, page: query.page, perPage: query.perPage, roleCounts, roles: options }
    },

    assignRole(auth, request, ctx) {
      const actor = { id: auth.account.id, username: auth.account.username }
      return inTransaction(db, async (tx) => {
        await lockRoleChanges(tx)

        // What the caller may do is read again under the lock: a request that waited for another one's change must not act on
        // the roles it had when it started.
        const grants = await listRoleGrants(tx, actor.id)
        const held = new Set(grants.flatMap((grant) => grant.capabilities))
        if (!held.has('promote_users')) {
          throw new ForbiddenError()
        }

        const target = await findRoleBySlug(tx, request.role)
        if (target === undefined) {
          throw new AppError(400, 'unknown_role', 'There is no such role')
        }
        // WordPress' `editable_roles`: a role may be given only by someone who holds all it grants, so nobody hands out more
        // than they have (an extension may give `promote_users` to a role that is not the administrator).
        if (!covers(held, target.capabilities)) {
          throw new AppError(403, 'forbidden_role', 'You may not give that role')
        }

        const accounts = await loadTargets(tx, request.userIds)
        // Active administrators still standing: each demotion below takes one out, and the last one cannot go.
        const standing = new Set(await listActiveAdministratorIds(tx))
        const now = clock()

        const changed: string[] = []
        const unchanged: string[] = []
        const skipped: { id: string; reason: AssignRoleSkipReason }[] = []
        for (const id of request.userIds) {
          const account = accounts.get(id)
          if (account === undefined) {
            skipped.push({ id, reason: 'not_found' })
            continue
          }
          if (id === actor.id) {
            skipped.push({ id, reason: 'self' })
            continue
          }
          if (!covers(held, account.capabilities)) {
            skipped.push({ id, reason: 'forbidden_user' })
            continue
          }
          if (account.roles.length === 1 && account.roles[0] === target.slug) {
            unchanged.push(id)
            continue
          }
          if (standing.has(id) && target.slug !== 'administrator') {
            if (standing.size === 1) {
              skipped.push({ id, reason: 'last_administrator' })
              continue
            }
            standing.delete(id)
          }
          await replaceRoles(tx, id, target.id, now)
          await audit(tx, ctx, {
            actor,
            action: 'user.role_changed',
            objectType: 'account',
            objectId: id,
            oldValue: { roles: [...account.roles] },
            newValue: { roles: [target.slug] },
          })
          changed.push(id)
        }
        return { changed, unchanged, skipped }
      })
    },
  }
}
