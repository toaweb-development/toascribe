import { z } from 'zod'

import { NewPassword } from './password.ts'
import { AccountStatus } from './values.ts'

// The users list and role assignment (M0.5; WordPress' users.php). `GET /api/v1/users` needs `list_users`, `PUT /api/v1/users/roles`
// needs `promote_users`. M0.5 only assigns the roles that exist; editing a role's capabilities, and making roles, come later.

const isoDate = z.iso.datetime({ offset: true })

/** A role slug as the api accepts it in a request: lower-case words joined by `-` or `_` (`editor`, `shop-manager`). */
export const RoleSlug = z
  .string()
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
export type RoleSlug = z.infer<typeof RoleSlug>

/**
 * The value of the `role` filter for accounts that hold no role at all (WordPress' «Ingen rolle» view). It is not a role slug a
 * role may have: the code that makes roles (later) must refuse `none` and `all`.
 */
export const NO_ROLE_FILTER = 'none'

export const USER_LIST_ORDER_BY = ['username', 'name', 'email', 'registered'] as const
export const UserListOrderBy = z.enum(USER_LIST_ORDER_BY)
export type UserListOrderBy = z.infer<typeof UserListOrderBy>

export const SORT_ORDER = ['asc', 'desc'] as const
export const SortOrder = z.enum(SORT_ORDER)
export type SortOrder = z.infer<typeof SortOrder>

/** WordPress shows 20 users per page. */
export const USERS_DEFAULT_PER_PAGE = 20
export const USERS_MAX_PER_PAGE = 100
export const USERS_SEARCH_MAX_LENGTH = 100

/**
 * GET /users. Strict: an unknown parameter is a 400. `search` matches username, e-mail, display name and nicename, without regard to
 * case, anywhere in the text; an empty `search` is the same as none. `role` is a role slug or `none`; a slug no role has gives an empty list.
 * The page size is `per_page`, as in every list of the API and in WordPress' REST API (PLAN «Besluttet»).
 */
export const UserListQuery = z.strictObject({
  search: z.string().trim().max(USERS_SEARCH_MAX_LENGTH).optional(),
  role: z.union([z.literal(NO_ROLE_FILTER), RoleSlug]).optional(),
  orderby: UserListOrderBy.default('username'),
  order: SortOrder.default('asc'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  per_page: z.coerce.number().int().min(1).max(USERS_MAX_PER_PAGE).default(USERS_DEFAULT_PER_PAGE),
})
export type UserListQuery = z.infer<typeof UserListQuery>

/** One row of the users table. No hash, no second-factor data, no token. */
export const UserListItem = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  email: z.string(),
  /** Role slugs, sorted. Empty for an account without a role. */
  roles: z.array(z.string()),
  status: AccountStatus,
  registeredAt: isoDate,
  /** Published posts (`content.type = post`, `status = publish`) the account is an author of: WordPress' «Innlegg» column. */
  postCount: z.int().min(0),
  /** The picture to show (M1.8): as on /me; null shows the initials. */
  avatarUrl: z.string().nullable(),
})
export type UserListItem = z.infer<typeof UserListItem>

/**
 * The views above the table. They ignore `search` and `page`, as WordPress' do. `all` is every account, `none` those without a role,
 * `roles` has one count per role that at least one account holds (an account with two roles counts in both). Under `roles`, not
 * beside `all` and `none`, so that no role slug can shadow them.
 */
export const UserRoleCounts = z.object({
  all: z.int().min(0),
  none: z.int().min(0),
  roles: z.record(z.string(), z.int().min(1)),
})
export type UserRoleCounts = z.infer<typeof UserRoleCounts>

/** A role for the filter and the «change role» select. `name` is the stored name; the admin translates the five built-in slugs. */
export const UserRoleOption = z.object({
  slug: z.string(),
  name: z.string(),
  /** Whether the signed-in account may give this role to others (it holds every capability the role has). */
  grantable: z.boolean(),
})
export type UserRoleOption = z.infer<typeof UserRoleOption>

export const UserListResponse = z.object({
  users: z.array(UserListItem),
  /** Accounts matching `search` and `role`, over all pages. */
  total: z.int().min(0),
  page: z.int().min(1),
  perPage: z.int().min(1),
  roleCounts: UserRoleCounts,
  /** Every role, in WordPress order: administrator, editor, author, contributor, subscriber, then the others by name. */
  roles: z.array(UserRoleOption),
})
export type UserListResponse = z.infer<typeof UserListResponse>

export const ASSIGN_ROLE_MAX_USERS = 100

/** PUT /users/roles: replace the roles of these accounts with that one role. */
export const AssignRoleRequest = z.strictObject({
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(ASSIGN_ROLE_MAX_USERS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each account may be named once' }),
  role: RoleSlug,
})
export type AssignRoleRequest = z.infer<typeof AssignRoleRequest>

/**
 * Why an account was left as it was:
 * - `not_found`: no such account (unknown id, or deleted).
 * - `self`: the signed-in account is never changed here.
 * - `last_administrator`: it is the last active administrator.
 * - `forbidden_user`: it holds a capability the signed-in account lacks.
 */
export const ASSIGN_ROLE_SKIP_REASONS = ['not_found', 'self', 'last_administrator', 'forbidden_user'] as const
export const AssignRoleSkipReason = z.enum(ASSIGN_ROLE_SKIP_REASONS)
export type AssignRoleSkipReason = z.infer<typeof AssignRoleSkipReason>

export const AssignRoleResponse = z.object({
  /** Accounts whose roles were replaced, in request order. */
  changed: z.array(z.uuid()),
  /** Accounts that already held exactly this role: nothing was written. */
  unchanged: z.array(z.uuid()),
  skipped: z.array(z.object({ id: z.uuid(), reason: AssignRoleSkipReason })),
})
export type AssignRoleResponse = z.infer<typeof AssignRoleResponse>

// ── «Legg til ny bruker» (K-020) ──────────────────────────────

/** POST /users (`create_users`). With `sendInvite` the account waits for its first password (a link by mail, 24 hours) and no
 * password is sent; without it a password is required and the account is active at once. As WordPress' user-new.php. */
export const CreateUserRequest = z
  .strictObject({
    username: z
      .string()
      .min(3)
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/),
    email: z.email().max(254),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    website: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional(),
    role: RoleSlug,
    sendInvite: z.boolean(),
    /** Required without `sendInvite`, refused with it. The password rules apply (`weak_password`). */
    password: NewPassword.optional(),
  })
  .refine((value) => (value.sendInvite ? value.password === undefined : value.password !== undefined), {
    message: 'Give a password, or send an invitation without one',
    path: ['password'],
  })
export type CreateUserRequest = z.infer<typeof CreateUserRequest>

export const CreateUserResponse = z.object({ id: z.uuid(), username: z.string(), invited: z.boolean() })
export type CreateUserResponse = z.infer<typeof CreateUserResponse>

// ── Slett bruker (K-021) ──────────────────────────────────────

/** GET /users/{id}: what the delete screen shows. `contentCount` is everything the account is an author of, any status. */
export const UserDetail = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  status: AccountStatus,
  contentCount: z.int().min(0),
})
export type UserDetail = z.infer<typeof UserDetail>

/**
 * DELETE /users/{id} (`delete_users`), as WordPress: «Slett alt innhold» (`reassignTo: null`) or «Tilordne alt innhold til»
 * another account. Content the account wrote with others keeps the other authors. Never the caller, never the last administrator.
 */
export const DeleteUserRequest = z.strictObject({ reassignTo: z.uuid().nullable() })
export type DeleteUserRequest = z.infer<typeof DeleteUserRequest>

export const DeleteUserResponse = z.object({
  /** Content moved to `reassignTo`. */
  reassigned: z.int().min(0),
  /** Content deleted for good (the account was its only author). */
  deleted: z.int().min(0),
})
export type DeleteUserResponse = z.infer<typeof DeleteUserResponse>

// ── Massehandling: send tilbakestilling av passord (K-022) ────

export const SEND_RESET_MAX_USERS = 100

export const SendPasswordResetRequest = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(SEND_RESET_MAX_USERS)
    .transform((ids) => [...new Set(ids)]),
})
export type SendPasswordResetRequest = z.infer<typeof SendPasswordResetRequest>

export const SendPasswordResetResponse = z.object({
  sent: z.int().min(0),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.enum(['not_found', 'disabled']) })),
})
export type SendPasswordResetResponse = z.infer<typeof SendPasswordResetResponse>

// ── Applikasjonspassord (K-016) ───────────────────────────────

export const APP_PASSWORD_NAME_MAX = 100

export const AppPasswordItem = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
  lastUsedIp: z.string().nullable(),
})
export type AppPasswordItem = z.infer<typeof AppPasswordItem>

export const AppPasswordListResponse = z.object({ items: z.array(AppPasswordItem) })
export type AppPasswordListResponse = z.infer<typeof AppPasswordListResponse>

export const CreateAppPasswordRequest = z.strictObject({ name: z.string().trim().min(1).max(APP_PASSWORD_NAME_MAX) })
export type CreateAppPasswordRequest = z.infer<typeof CreateAppPasswordRequest>

/** The password is in this answer and nowhere else: only its hash is kept (as WordPress, shown once). */
export const CreateAppPasswordResponse = z.object({ item: AppPasswordItem, password: z.string() })
export type CreateAppPasswordResponse = z.infer<typeof CreateAppPasswordResponse>
