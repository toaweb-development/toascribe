import { AssignRoleResponse, UserListResponse } from '@toascribe/shared'
import type { AssignRoleRequest, UserListQuery } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

/** The versioned API: `apiBase` is `/api`, the users endpoints are under `/api/v1`. */
const V1 = '/v1'

/**
 * The query string of `GET /users`: only what differs from nothing. An empty or missing `search` and `role` are left out (the API
 * reads an empty `search` as none, and an empty `role` is not a slug); the rest is always sent, so a page never depends on a default.
 * Keys are sorted by the order of this list, not by the caller's object, so the same query is the same address.
 */
export function usersQueryString(query: UserListQuery): string {
  const params = new URLSearchParams()
  if (query.search !== undefined && query.search.trim() !== '') {
    params.set('search', query.search.trim())
  }
  if (query.role !== undefined && query.role !== '') {
    params.set('role', query.role)
  }
  params.set('orderby', query.orderby)
  params.set('order', query.order)
  params.set('page', String(query.page))
  params.set('perPage', String(query.perPage))
  return params.toString()
}

/**
 * The users list and role assignment (M0.5; WordPress' users.php). `list` needs `list_users`, `assignRole` needs `promote_users`.
 * Every answer is parsed with the shared schema. Errors are ApiRequestError: `assignRole` can fail as a whole with 400
 * `unknown_role` or 403 `forbidden_role`; an account that was left alone is in `skipped` of a 200 answer, with the reason.
 */
export function createUsersApi(api: ApiCall) {
  return {
    /** One page of accounts, the views' counts and the roles (with `grantable`). */
    list: async (query: UserListQuery) => UserListResponse.parse(await api(`${V1}/users?${usersQueryString(query)}`)),
    /** Replaces the roles of these accounts with that one role. Which were changed, which already had it, which were left alone. */
    assignRole: async (request: AssignRoleRequest) =>
      AssignRoleResponse.parse(await api(`${V1}/users/roles`, { method: 'PUT', body: request })),
  }
}

export type UsersApi = ReturnType<typeof createUsersApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useUsersApi(): UsersApi {
  const { $api } = useNuxtApp()
  return createUsersApi($api)
}
