import { CONTENT_LIST_STATUS, CONTENT_SEARCH_MAX_LENGTH, ContentMonth } from '@toascribe/shared'
import type { ContentListQueryInput, ContentListStatus, ContentOrderBy, ContentTypeKey } from '@toascribe/shared'

// The state of a content list (view, search, month, sort, page) lives in the address, as on the users list (workflows §7), so a
// reload, the back button and a link show the same list. This is the mapping between the route's query string and the API's
// `ContentListQuery`, with no Vue in it. A value the screen does not understand falls back to the default, never to an error.

/** The columns a list sorts by: Tittel and Dato, as WordPress' edit.php. */
export const CONTENT_SORT_COLUMNS = ['title', 'date'] as const
export type ContentSortColumn = (typeof CONTENT_SORT_COLUMNS)[number]

export interface ContentView {
  /** `all` is every status but the trash. */
  status: ContentListStatus
  /** The «Mine» view: only the signed-in account's items. */
  mine: boolean
  search: string
  /** `YYYY-MM`, or empty for «Alle datoer». */
  month: string
  /** A category id, or empty for «Alle kategorier». */
  category: string
  /** A tag id (from a tag link in the list), or empty. */
  tag: string
  /** Empty: the type's default (date for posts, the page tree for pages). */
  orderby: ContentSortColumn | ''
  order: 'asc' | 'desc' | ''
  page: number
}

export const DEFAULT_CONTENT_VIEW: Readonly<ContentView> = {
  status: 'all',
  mine: false,
  search: '',
  month: '',
  category: '',
  tag: '',
  orderby: '',
  order: '',
  page: 1,
}

const MAX_PAGE = 1_000_000

type RouteValue = string | null | undefined | readonly (string | null)[]

function firstText(value: RouteValue): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' ? text : undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idOrEmpty(text: string | undefined): string {
  return text !== undefined && UUID.test(text) ? text.toLowerCase() : ''
}

/** The state an address stands for. */
export function parseContentView(query: Readonly<Record<string, RouteValue>>): ContentView {
  const status = firstText(query.status)
  const orderby = firstText(query.orderby)
  const order = firstText(query.order)
  const month = firstText(query.month)
  const page = firstText(query.page)
  return {
    status: CONTENT_LIST_STATUS.find((value) => value === status) ?? 'all',
    mine: firstText(query.author) === 'mine',
    search: (firstText(query.search) ?? '').trim().slice(0, CONTENT_SEARCH_MAX_LENGTH).trim(),
    month: ContentMonth.safeParse(month).success ? (month ?? '') : '',
    category: idOrEmpty(firstText(query.category)),
    tag: idOrEmpty(firstText(query.tag)),
    orderby: CONTENT_SORT_COLUMNS.find((column) => column === orderby) ?? '',
    order: order === 'asc' || order === 'desc' ? order : '',
    page: page !== undefined && /^\d{1,7}$/.test(page) ? Math.min(Math.max(Number(page), 1), MAX_PAGE) : 1,
  }
}

/** The address of a state: only what differs from the default. */
export function contentViewQuery(view: ContentView): Record<string, string> {
  const query: Record<string, string> = {}
  if (view.status !== 'all') query.status = view.status
  if (view.mine) query.author = 'mine'
  if (view.search !== '') query.search = view.search
  if (view.month !== '') query.month = view.month
  if (view.category !== '') query.category = view.category
  if (view.tag !== '') query.tag = view.tag
  if (view.orderby !== '') query.orderby = view.orderby
  if (view.order !== '') query.order = view.order
  if (view.page !== 1) query.page = String(view.page)
  return query
}

/** What `GET /content` is asked for. «Mine» becomes the signed-in account's id. */
export function toContentListQuery(
  view: ContentView,
  type: ContentTypeKey,
  accountId: string | undefined,
  perPage: number,
): ContentListQueryInput {
  return {
    type,
    status: view.status,
    ...(view.mine && accountId !== undefined ? { author: accountId } : {}),
    ...(view.search === '' ? {} : { search: view.search }),
    ...(view.month === '' ? {} : { month: view.month }),
    ...(view.category === '' ? {} : { category: view.category }),
    ...(view.tag === '' ? {} : { tag: view.tag }),
    ...(view.orderby === '' ? {} : { orderby: view.orderby satisfies ContentOrderBy }),
    ...(view.order === '' ? {} : { order: view.order }),
    page: view.page,
    per_page: perPage,
  }
}

/** A change of view, search, month or sort starts on the first page; a change of page keeps everything else. */
export function changeContentView(view: ContentView, changes: Partial<ContentView>): ContentView {
  return { ...view, page: 1, ...changes }
}

/** The order a column is sorted in when the list does not say: the newest first by date, A to Z by title. */
function defaultOrder(column: ContentSortColumn): 'asc' | 'desc' {
  return column === 'date' ? 'desc' : 'asc'
}

/** The sort the list has now: what the address says, or the type's default (posts by date; pages as a tree, so no column). */
export function currentSort(
  view: ContentView,
  type: ContentTypeKey,
): { column: ContentSortColumn | undefined; order: 'asc' | 'desc' } {
  const column = view.orderby !== '' ? view.orderby : type === 'post' ? 'date' : undefined
  return { column, order: view.order !== '' ? view.order : column === undefined ? 'asc' : defaultOrder(column) }
}

/** The click on a column heading: the sorted column flips, another starts in its own default order (WordPress). */
export function sortContentBy(view: ContentView, type: ContentTypeKey, column: ContentSortColumn): ContentView {
  const now = currentSort(view, type)
  const order = now.column === column ? (now.order === 'asc' ? 'desc' : 'asc') : defaultOrder(column)
  return changeContentView(view, { orderby: column, order })
}

export function ariaSortOfContent(
  view: ContentView,
  type: ContentTypeKey,
  column: ContentSortColumn,
): 'ascending' | 'descending' | 'none' {
  const now = currentSort(view, type)
  if (now.column !== column) return 'none'
  return now.order === 'asc' ? 'ascending' : 'descending'
}
