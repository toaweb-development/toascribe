// The theme SDK (M1.4; PLAN «Regler et tema må følge» 1): the only way a theme reads data. useContent gives what the address is,
// useQuery lists published items, useSettings the site's settings, useUser who is signed in, useMenu a theme location's menu and
// useGlobalSet a global set (M1.5); useArea answers empty until areas come (phase 3).
import type { Block } from '@toascribe/blocks'
import type {
  PublicArchive,
  PublicContent,
  PublicList,
  PublicGlobalSetResponse,
  PublicListResponse,
  PublicMenuItem,
  PublicMenuResponse,
  PublicQueryInput,
  PublicSettings,
  ResolveResponse,
} from '@toascribe/shared'
import type { MaybeRefOrGetter } from 'vue'

import { addressOf, pageBlocks } from '../lib/scribe'

/** What the catch-all route resolved for the address, and whether it came from a preview link. */
export interface ScribeState {
  readonly key: string
  readonly resolved: ResolveResponse
  readonly preview: boolean
}

/** The resolved address, kept in the page payload so the browser does not ask again. */
export function useScribeState() {
  return useState<ScribeState | null>('scribe:resolved', () => null)
}

/** The site's settings, read once per page load (the catch-all route reads them with the address). */
export function useSettings() {
  return useState<PublicSettings | null>('scribe:settings', () => null)
}

/** What the address is: an item, a list (home, archive, search) or nothing (404). */
export function useContent() {
  const state = useScribeState()
  const resolved = computed(() => state.value?.resolved)
  const content = computed<PublicContent | undefined>(() => {
    const value = resolved.value
    return value !== undefined && 'content' in value ? value.content : undefined
  })
  const list = computed<PublicList | undefined>(() => {
    const value = resolved.value
    return value !== undefined && 'list' in value ? value.list : undefined
  })
  const archive = computed<PublicArchive | undefined>(() => {
    const value = resolved.value
    return value !== undefined && 'archive' in value ? value.archive : undefined
  })
  return {
    kind: computed(() => resolved.value?.kind ?? '404'),
    templates: computed(() => {
      const value = resolved.value
      return value !== undefined && 'templates' in value ? value.templates : ['404', 'index']
    }),
    content,
    /** The blocks of the page shown of a post split by page breaks (all of them when it has one page). */
    blocks: computed<Block[]>(() =>
      content.value === undefined ? [] : pageBlocks(content.value.blocks as unknown as Block[], content.value.page),
    ),
    list,
    archive,
    /** True when a preview link shows the item (draft or not): the template may say so. */
    preview: computed(() => state.value?.preview === true),
  }
}

/** Published posts or pages by filter (K-085). Call in setup; it is fetched on the server and kept in the payload. */
export function useQuery(query: MaybeRefOrGetter<PublicQueryInput>) {
  const fetcher = useRequestFetch()
  const key = computed(() => `scribe:query:${JSON.stringify(toValue(query))}`)
  return useAsyncData(key, () =>
    fetcher<PublicListResponse>('/_toascribe/data/query', { query: toValue(query) as Record<string, unknown> }),
  )
}

/**
 * The menu in a theme location (K-132): its items with the current titles and addresses, published content only. Call in setup; it
 * is read on the server and kept in the payload. Empty when no menu stands there.
 */
export function useMenu(location: MaybeRefOrGetter<string>) {
  const fetcher = useRequestFetch()
  const key = computed(() => `scribe:menu:${toValue(location)}`)
  const { data } = useAsyncData(key, () => fetcher<PublicMenuResponse>(`/_toascribe/data/menu/${toValue(location)}`), {
    default: () => undefined,
  })
  return computed<readonly PublicMenuItem[]>(() => data.value?.items ?? [])
}

/** A widget area's blocks. Areas come in phase 3; until then every area is empty. */
export function useArea(_id: string) {
  return computed<readonly Block[]>(() => [])
}

/**
 * A global set by its slug (K-106): its blocks and their media, for `<ScribeBlocks>`. Undefined while there is none of the slug (a
 * theme's expected set is made empty in «Globale sett»).
 */
export function useGlobalSet(slug: MaybeRefOrGetter<string>) {
  const fetcher = useRequestFetch()
  const key = computed(() => `scribe:global-set:${toValue(slug)}`)
  const { data } = useAsyncData(
    key,
    () => fetcher<PublicGlobalSetResponse | null>(`/_toascribe/data/global-set/${toValue(slug)}`).catch(() => null),
    { default: () => null },
  )
  return data
}

/** Who is signed in, for the toolbar (K-032) and a theme that greets them; `anonymous` for a visitor. */
export function useUser() {
  const auth = useAuth()
  return auth.session
}

/** Asks again what the current address is (after a post password opened it). */
export function useScribeRefresh() {
  const fetcher = useRequestFetch()
  const route = useRoute()
  const state = useScribeState()
  return async () => {
    const address = addressOf(route)
    if (address.kind !== 'resolve') return
    const resolved = await fetcher<ResolveResponse>('/_toascribe/data/resolve', { query: { path: address.path } })
    state.value = { key: JSON.stringify(address), resolved, preview: false }
  }
}
