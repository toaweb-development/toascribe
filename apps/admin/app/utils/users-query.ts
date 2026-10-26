import { NO_ROLE_FILTER, RoleSlug, USERS_DEFAULT_PER_PAGE, USERS_SEARCH_MAX_LENGTH } from '@toascribe/shared'
import type { SortOrder, UserListQuery } from '@toascribe/shared'

// The users list's state (view, search, sort, page) lives in the address (workflows §7), so a reload, the back button and a
// link all show the same list. This is the mapping between the route's query string and the API's `UserListQuery`, with no Vue and no
// router in it. A parameter the screen does not understand is ignored the way WordPress ignores it: the default is used, never an error.

/** The columns the screen sorts by (WordPress' users.php: Brukernavn, Navn, E-post). The API also sorts by `registered`; no column asks for it. */
export const USERS_SORT_COLUMNS = ['username', 'name', 'email'] as const
export type UsersSortColumn = (typeof USERS_SORT_COLUMNS)[number]

export interface UsersView {
  /** A role slug, or `none` for accounts without a role. No value is «Alle». */
  role: string | undefined
  /** What the person searched for; empty is no search. */
  search: string
  orderby: UsersSortColumn
  order: SortOrder
  /** 1-based. */
  page: number
}

export const DEFAULT_USERS_VIEW: Readonly<UsersView> = {
  role: undefined,
  search: '',
  orderby: 'username',
  order: 'asc',
  page: 1,
}

/** The largest page number accepted from the address; the API takes a million. */
const MAX_PAGE = 1_000_000

/** A route query value: Vue Router gives a string, an array for a repeated parameter, or null for `?x`. */
type RouteValue = string | null | undefined | readonly (string | null)[]

function firstText(value: RouteValue): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' ? text : undefined
}

function sortColumn(text: string | undefined): UsersSortColumn {
  return USERS_SORT_COLUMNS.find((column) => column === text) ?? DEFAULT_USERS_VIEW.orderby
}

/** The state an address stands for. */
export function parseUsersView(query: Readonly<Record<string, RouteValue>>): UsersView {
  const role = firstText(query.role)
  const page = firstText(query.page)
  const order = firstText(query.order)
  return {
    role: role === NO_ROLE_FILTER || RoleSlug.safeParse(role).success ? role : undefined,
    search: (firstText(query.search) ?? '').trim().slice(0, USERS_SEARCH_MAX_LENGTH).trim(),
    orderby: sortColumn(firstText(query.orderby)),
    order: order === 'desc' ? 'desc' : 'asc',
    page: page !== undefined && /^\d{1,7}$/.test(page) ? Math.min(Math.max(Number(page), 1), MAX_PAGE) : 1,
  }
}

/** The address for a state: only what differs from the default, so the plain list has a plain address. */
export function usersViewQuery(view: UsersView): Record<string, string> {
  const query: Record<string, string> = {}
  if (view.role !== undefined) {
    query.role = view.role
  }
  if (view.search !== '') {
    query.search = view.search
  }
  if (view.orderby !== DEFAULT_USERS_VIEW.orderby) {
    query.orderby = view.orderby
  }
  if (view.order !== DEFAULT_USERS_VIEW.order) {
    query.order = view.order
  }
  if (view.page !== 1) {
    query.page = String(view.page)
  }
  return query
}

/** What `GET /users` is asked for. */
export function toUserListQuery(view: UsersView, perPage: number = USERS_DEFAULT_PER_PAGE): UserListQuery {
  return {
    ...(view.search === '' ? {} : { search: view.search }),
    ...(view.role === undefined ? {} : { role: view.role }),
    orderby: view.orderby,
    order: view.order,
    page: view.page,
    per_page: perPage,
  }
}

/**
 * A change of view, search or sort starts on the first page (a page number means nothing for another list); a change of page
 * keeps everything else.
 */
export function changeUsersView(view: UsersView, changes: Partial<UsersView>): UsersView {
  return { ...view, page: 1, ...changes }
}

/** The click on a column heading: the column the list is already sorted by flips, another starts ascending (WordPress). */
export function sortUsersBy(view: UsersView, column: UsersSortColumn): UsersView {
  const order: SortOrder = view.orderby === column && view.order === 'asc' ? 'desc' : 'asc'
  return changeUsersView(view, { orderby: column, order })
}

/** What `aria-sort` says for a column. */
export function ariaSortOf(view: UsersView, column: UsersSortColumn): 'ascending' | 'descending' | 'none' {
  if (view.orderby !== column) {
    return 'none'
  }
  return view.order === 'asc' ? 'ascending' : 'descending'
}

/** How many pages a total makes. At least one: an empty list is page 1 of 1. */
export function pageCountOf(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage))
}
