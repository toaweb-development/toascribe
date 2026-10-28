// The users list and role assignment (M0.5; WordPress' users.php). Capabilities are read from the database on every request
// (SessionService.authenticate), so a role change reaches the changed account's open sessions at their next request.
import { hashPassword, isTooObvious } from '@toascribe/auth'
import { deleteContentPermanently } from '@toascribe/db'
import type { Database } from '@toascribe/db'
import { EMPTY_PROFILE } from '@toascribe/shared'
import type {
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  SendPasswordResetRequest,
  SendPasswordResetResponse,
  UserDetail,
  AssignRoleRequest,
  AssignRoleResponse,
  AssignRoleSkipReason,
  UserListItem,
  UserListQuery,
  UserListResponse,
  UserRoleOption,
} from '@toascribe/shared'

import type { SessionAuth } from '../lib/auth-context.ts'
import { uniqueViolation } from '../lib/db-errors.ts'
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors.ts'
import {
  findAccountById,
  findAccountsByUsernameOrEmail,
  freeNicename,
  grantRole,
  insertAccount,
  listRoleGrants,
  setPasswordAndActivate,
  updateProfile,
} from '../repositories/accounts.ts'
import { recordInvalidation } from '../repositories/public.ts'
import {
  authoredContent,
  countAuthoredContent,
  deleteAccount,
  lockAccount,
  dropAuthorship,
  reassignAuthorship,
  reassignUploads,
} from '../repositories/user-admin.ts'
import { issueAccountLink, nicenameFor, UsernameTakenError, WeakPasswordError } from './account-links.ts'
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
import type { Auditor, RequestContext, SafeMail } from './support.ts'
import { avatarUrls } from './avatars.ts'
import type { MediaService } from './media.ts'
import { readProfile } from './me.ts'

export interface UserService {
  /** One page of the users table with the views and the roles to filter and assign by. */
  list: (auth: SessionAuth, query: UserListQuery) => Promise<UserListResponse>
  /**
   * Replaces the roles of the accounts with one role, in one transaction, one audit entry per changed account. An account that
   * cannot be changed is left out and named with its reason; an unknown role is a 400 and a role the caller may not give a 403,
   * both for the whole request.
   */
  assignRole: (auth: SessionAuth, request: AssignRoleRequest, ctx: RequestContext) => Promise<AssignRoleResponse>
  /** «Legg til ny bruker» (K-020): `create_users`, and a role the caller holds every capability of. */
  create: (auth: SessionAuth, request: CreateUserRequest, ctx: RequestContext) => Promise<CreateUserResponse>
  /** One account, for the delete screen (`list_users`). */
  get: (auth: SessionAuth, id: string) => Promise<UserDetail>
  /** Deletes an account (K-021, `delete_users`): its content to another account, or deleted. Never oneself or the last administrator. */
  remove: (
    auth: SessionAuth,
    id: string,
    request: DeleteUserRequest,
    ctx: RequestContext,
  ) => Promise<DeleteUserResponse>
  /** «Send tilbakestilling av passord» for several accounts (K-022, `edit_users`). */
  sendPasswordResets: (
    auth: SessionAuth,
    request: SendPasswordResetRequest,
    ctx: RequestContext,
  ) => Promise<SendPasswordResetResponse>
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

export class EmailTakenError extends AppError {
  constructor() {
    super(409, 'email_taken', 'An account already has this e-mail address')
  }
}

function requireCapability(auth: SessionAuth, capability: string): void {
  if (!auth.capabilities.has(capability)) throw new ForbiddenError()
}

/**
 * Accounts, roles and passwords are changed by a person in the admin, never by a client with an application password (M1.8
 * review): otherwise a leaked administrator's application password could make a new administrator with a known password and sign
 * in to the admin with it, past the second factor.
 */
function requireCookieSession(auth: SessionAuth): void {
  if (auth.via !== 'cookie') throw new AppError(403, 'session_required', 'Sign in to the admin to change users')
}

export function createUserService(options: {
  readonly db: Database
  readonly clock: () => Date
  readonly audit: Auditor
  readonly mail: SafeMail
  readonly media: Pick<MediaService, 'contentRefs'>
}): UserService {
  const { db, clock, audit, mail } = options
  const media = options.media

  return {
    async list(auth, query) {
      const filter = { search: query.search, role: query.role }
      const [rows, total, roleCounts, roleRows] = await Promise.all([
        listAccountPage(db, filter, query.orderby, query.order, query.per_page, (query.page - 1) * query.per_page),
        countAccounts(db, filter),
        countByRole(db),
        listRoles(db),
      ])
      const ids = rows.map((row) => row.id)
      const [roles, posts, avatars] = await Promise.all([
        roleSlugsOf(db, ids),
        publishedPostCounts(db, ids),
        avatarUrls(
          db,
          media,
          rows.map((row) => ({ id: row.id, email: row.email, avatarId: readProfile(row.profile).avatarId })),
        ),
      ])
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
        avatarUrl: avatars.get(row.id) ?? null,
      }))
      const options: UserRoleOption[] = roleRows
        .map((row) => ({ slug: row.slug, name: row.name, grantable: covers(auth.capabilities, row.capabilities) }))
        .sort(compareRoles)
      return { users, total, page: query.page, perPage: query.per_page, roleCounts, roles: options }
    },

    assignRole(auth, request, ctx) {
      requireCookieSession(auth)
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

    async create(auth, request, ctx) {
      requireCookieSession(auth)
      requireCapability(auth, 'create_users')
      const role = await findRoleBySlug(db, request.role)
      if (role === undefined) throw new AppError(400, 'unknown_role', 'There is no such role')
      // As assignRole: nobody makes an account with more than they hold themselves.
      if (!covers(auth.capabilities, role.capabilities)) {
        throw new AppError(403, 'forbidden_role', 'You may not give that role')
      }
      if (request.password !== undefined && isTooObvious(request.password, request)) throw new WeakPasswordError()
      const taken = await findAccountsByUsernameOrEmail(db, request.username, request.email)
      if (taken.some((other) => other.username.toLowerCase() === request.username.toLowerCase())) {
        throw new UsernameTakenError()
      }
      if (taken.some((other) => other.email.toLowerCase() === request.email.toLowerCase())) throw new EmailTakenError()
      const passwordHash = request.password === undefined ? null : await hashPassword(request.password)
      const now = clock()
      let created: { id: string; token: string | null }
      try {
        created = await inTransaction(db, async (tx) => {
          const id = await insertAccount(tx, {
            username: request.username,
            email: request.email,
            nicename: await freeNicename(tx, nicenameFor(request.username)),
            status: passwordHash === null ? 'pending' : 'active',
            now,
          })
          if (passwordHash !== null) await setPasswordAndActivate(tx, id, passwordHash, now)
          await updateProfile(
            tx,
            id,
            request.username,
            {
              ...EMPTY_PROFILE,
              firstName: request.firstName ?? '',
              lastName: request.lastName ?? '',
              website: request.website ?? '',
            },
            now,
          )
          await grantRole(tx, id, role.id, now)
          const token = request.sendInvite ? await issueAccountLink(tx, id, 'set_password', now) : null
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'user.created',
            objectType: 'account',
            objectId: id,
            accountId: id,
            newValue: { role: role.slug, invited: request.sendInvite },
          })
          return { id, token }
        })
      } catch (err) {
        // Two requests for the same name or address at once: the second is told as if it had seen the first.
        const constraint = uniqueViolation(err)
        if (constraint?.includes('email') === true) throw new EmailTakenError()
        if (constraint !== undefined) throw new UsernameTakenError()
        throw err
      }
      if (created.token !== null) {
        await mail({
          template: 'set_password',
          to: request.email,
          data: { username: request.username, token: created.token },
        })
      }
      return { id: created.id, username: request.username, invited: request.sendInvite }
    },

    async get(auth, id) {
      requireCapability(auth, 'list_users')
      const found = await findAccountById(db, id)
      if (found === undefined) throw new NotFoundError()
      const [roles, contentCount] = await Promise.all([roleSlugsOf(db, [id]), countAuthoredContent(db, id)])
      return {
        id,
        username: found.username,
        displayName: found.displayName,
        email: found.email,
        roles: roles.get(id) ?? [],
        status: found.status as UserDetail['status'],
        contentCount,
      }
    },

    remove(auth, id, request, ctx) {
      requireCookieSession(auth)
      const actor = { id: auth.account.id, username: auth.account.username }
      return inTransaction(db, async (tx) => {
        // Under the role lock: two deletions (or a deletion and a demotion) cannot both take the last administrator.
        await lockRoleChanges(tx)
        const held = new Set((await listRoleGrants(tx, actor.id)).flatMap((grant) => grant.capabilities))
        if (!held.has('delete_users')) throw new ForbiddenError()
        if (id === actor.id) throw new AppError(409, 'self', 'You cannot delete your own account')
        // The account row first: an author link added meanwhile waits for this and then fails, instead of failing the delete.
        await lockAccount(tx, id)
        const target = (await loadTargets(tx, [id])).get(id)
        if (target === undefined) throw new NotFoundError()
        if (!covers(held, target.capabilities))
          throw new AppError(403, 'forbidden_user', 'You may not delete that user')
        const administrators = await listActiveAdministratorIds(tx)
        if (administrators.includes(id) && administrators.length === 1) {
          throw new AppError(409, 'last_administrator', 'The last administrator cannot be deleted')
        }
        if (request.reassignTo !== null) {
          if (request.reassignTo === id)
            throw new AppError(400, 'reassign_invalid', 'Choose another user for the content')
          const heir = await findAccountById(tx, request.reassignTo)
          if (heir === undefined)
            throw new AppError(400, 'reassign_invalid', 'There is no such user to give the content to')
        }

        const items = await authoredContent(tx, id)
        let reassigned = 0
        let deleted = 0
        if (request.reassignTo !== null) {
          await reassignAuthorship(
            tx,
            id,
            request.reassignTo,
            items.map((item) => item.contentId),
          )
          await reassignUploads(tx, id, request.reassignTo)
          reassigned = items.length
        } else {
          // Content the account wrote alone goes; content shared with others keeps the others as its authors.
          const alone = items.filter((item) => item.authors === 1).map((item) => item.contentId)
          const shared = items.filter((item) => item.authors > 1).map((item) => item.contentId)
          await dropAuthorship(tx, id, shared)
          for (const contentId of alone) {
            if ((await deleteContentPermanently(tx, contentId)) !== undefined) deleted += 1
          }
        }
        if (!(await deleteAccount(tx, id))) throw new NotFoundError()
        await audit(tx, ctx, {
          actor,
          action: 'user.deleted',
          objectType: 'account',
          objectId: id,
          accountId: null,
          oldValue: { username: target.username, roles: [...target.roles] },
          newValue: { reassignTo: request.reassignTo, reassigned, deleted },
        })
        // Bylines, author archives and lists change on the site: everything is drawn again.
        if (items.length > 0) await recordInvalidation(tx, ['*'], clock())
        return { reassigned, deleted }
      })
    },

    async sendPasswordResets(auth, request, ctx) {
      requireCookieSession(auth)
      requireCapability(auth, 'edit_users')
      const targets = await loadTargets(db, request.ids)
      const sent: { email: string; username: string; purpose: 'set_password' | 'password_reset'; token: string }[] = []
      const skipped: SendPasswordResetResponse['skipped'] = []
      await inTransaction(db, async (tx) => {
        for (const id of request.ids) {
          const target = targets.get(id)
          const found = target === undefined ? undefined : await findAccountById(tx, id)
          if (target === undefined || found === undefined || !covers(auth.capabilities, target.capabilities)) {
            skipped.push({ id, reason: 'not_found' })
            continue
          }
          if (found.status === 'disabled') {
            skipped.push({ id, reason: 'disabled' })
            continue
          }
          // As the lost-password flow: an account that never chose a password gets its welcome link instead.
          const purpose = found.status === 'pending' ? 'set_password' : 'password_reset'
          const token = await issueAccountLink(tx, id, purpose, clock())
          await audit(tx, ctx, {
            actor: { id: auth.account.id, username: auth.account.username },
            action: 'password.reset_sent',
            objectType: 'account',
            objectId: id,
            accountId: id,
          })
          sent.push({ email: found.email, username: found.username, purpose, token })
        }
      })
      // After the commit: a link is only mailed once it is stored.
      for (const item of sent) {
        await mail({ template: item.purpose, to: item.email, data: { username: item.username, token: item.token } })
      }
      return { sent: sent.length, skipped }
    },
  }
}
