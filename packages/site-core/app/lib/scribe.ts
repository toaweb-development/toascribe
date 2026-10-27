// The plain helpers of the site's core (M1.4): what an address asks the api, the blocks of one page of a split post, the addresses of
// the pages of an archive, and which template draws an answer. No Nuxt here, so the tests call them directly.
import type { Block } from '@toascribe/blocks'
import { NEXTPAGE } from '@toascribe/blocks'

/** What the catch-all route asks for an address: a preview link's item, or what the address is. */
export type Address =
  | { readonly kind: 'preview'; readonly token: string; readonly page: number }
  | { readonly kind: 'resolve'; readonly path: string }

const firstOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined

/**
 * The question an address asks. Only the query parameters the api reads go along (`s` for a search, `p` for `/?p=12` with its `page`), so a
 * tracking parameter makes no new answer; `preview` (with `page`) asks for a preview link's item instead.
 */
export function addressOf(route: {
  readonly path: string
  readonly query: Readonly<Record<string, unknown>>
}): Address {
  const preview = firstOf(route.query['preview'])
  if (preview !== undefined && preview !== '') {
    const page = Number(firstOf(route.query['page']) ?? '1')
    return { kind: 'preview', token: preview, page: Number.isInteger(page) && page >= 1 ? page : 1 }
  }
  const params = new URLSearchParams()
  for (const key of ['s', 'p']) {
    const value = firstOf(route.query[key])
    if (value !== undefined) params.set(key, value)
  }
  // Under «Enkel» a post's second page is `/?p=12&page=2` (M1.5).
  const page = firstOf(route.query['page'])
  if (params.has('p') && page !== undefined && /^\d{1,5}$/.test(page)) params.set('page', page)
  const query = params.toString()
  return { kind: 'resolve', path: query === '' ? route.path : `${route.path}?${query}` }
}

/** The blocks of one page of a post split by page breaks (K-227): page 1 is what comes before the first break. */
export function pageBlocks(blocks: readonly Block[], page: number): Block[] {
  const pages: Block[][] = [[]]
  for (const block of blocks) {
    if (block.type === NEXTPAGE) pages.push([])
    else pages.at(-1)?.push(block)
  }
  return pages[page - 1] ?? []
}

/** An archive's address without its page (`/category/mat/page/2/` → `/category/mat/`). */
export function archiveBase(path: string): string {
  const base = path.replace(/page\/\d+\/?$/, '')
  return base.endsWith('/') ? base : `${base}/`
}

/** The address of page `page` of an archive (WordPress: `/page/2/`), with the search kept. */
export function archivePage(path: string, page: number, search?: string): string {
  const base = archiveBase(path)
  const at = page <= 1 ? base : `${base}page/${String(page)}/`
  return search === undefined ? at : `${at}?${new URLSearchParams({ s: search }).toString()}`
}

/**
 * The address of page `page` of a split item (WordPress: `/slug/2/`, also for a structure without the closing slash); the front
 * page's second page is `/2/`. Under «Enkel» the item is `/?p=12`, and its page `/?p=12&page=2`, as the api reads it.
 */
export function itemPage(path: string, page: number): string {
  if (path.includes('?')) return page <= 1 ? path : `${path}&page=${String(page)}`
  const base = path.endsWith('/') ? path : `${path}/`
  return page <= 1 ? base : `${base}${String(page)}/`
}

/** The maintenance view (M1.7): the theme's `maintenance` template, or the core's page. */
export function maintenanceView<T>(available: Readonly<Record<string, T>>, core: T): T {
  return Object.hasOwn(available, 'maintenance') ? (available['maintenance'] as T) : core
}

/** The first template of the answer's list that the theme has; `index` is the last in every list. */
export function pickTemplate<T>(names: readonly string[], available: Readonly<Record<string, T>>): T | undefined {
  // Own names only: a template called `constructor` is no template, not Object's.
  for (const name of [...names, 'index']) {
    if (Object.hasOwn(available, name)) return available[name]
  }
  return undefined
}

/** A redirect the site follows: a path on the site, never another host. */
export function isLocalPath(location: string): boolean {
  // A browser drops tabs and newlines from an address before it reads it, so `/\t/host` is `//host`: no control character, and no
  // backslash anywhere (a browser reads it as a slash).
  return location.startsWith('/') && !location.startsWith('//') && !/[\p{Cc}\\]/u.test(location)
}
