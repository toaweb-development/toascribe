import { PublicListResponse, PublicSettings, ResolveResponse } from '@toascribe/shared'
import type { PublicQueryInput } from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const BASE = '/v1/public'

/** The query string of `GET /public/query`: only what is set, in a fixed order. */
export function publicQueryString(query: PublicQueryInput): string {
  const params = new URLSearchParams()
  for (const key of [
    'type',
    'category',
    'tag',
    'author',
    'year',
    'month',
    'day',
    'search',
    'orderby',
    'order',
    'page',
    'per_page',
    'exclude_sticky',
    'sticky_first',
  ] as const) {
    const value = query[key]
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

/**
 * The public reading API (M1.4): what the site's theme SDK reads. Open to anyone; every answer is parsed with the shared schema.
 * On the server the visitor's cookie goes along (the API plugin forwards it), so a post password cookie opens its item.
 */
export function createPublicApi(api: ApiCall) {
  return {
    settings: async () => PublicSettings.parse(await api(`${BASE}/settings`)),
    /** What an address on the site is: its path and query (`/hei/`, `/?s=fjell`). */
    resolve: async (path: string) =>
      ResolveResponse.parse(await api(`${BASE}/resolve?${new URLSearchParams({ path }).toString()}`)),
    query: async (query: PublicQueryInput = {}) => {
      const search = publicQueryString(query)
      return PublicListResponse.parse(await api(search === '' ? `${BASE}/query` : `${BASE}/query?${search}`))
    },
    /** Sets the post password cookie when the password is right (K-067); ApiRequestError `wrong_password` when it is not. */
    unlock: async (contentId: string, password: string) => {
      await api(`${BASE}/unlock`, { method: 'POST', body: { contentId, password } })
    },
    /** The item a preview link shows (K-071). */
    preview: async (token: string, page = 1) =>
      ResolveResponse.parse(
        await api(`${BASE}/preview?${new URLSearchParams({ token, page: String(page) }).toString()}`),
      ),
  }
}

export type PublicApi = ReturnType<typeof createPublicApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function usePublicApi(): PublicApi {
  const { $api } = useNuxtApp()
  return createPublicApi($api)
}
