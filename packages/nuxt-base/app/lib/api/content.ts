import {
  ContentAuthorsResponse,
  ContentBulkResponse,
  ContentItem,
  ContentListResponse,
  PreviewLinkResponse,
} from '@toascribe/shared'
import type {
  ContentBulkRequest,
  ContentListQueryInput,
  ContentTypeKey,
  CreateContentRequest,
  UpdateContentRequest,
} from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const V1 = '/v1'

/**
 * The query string of `GET /content`: `type` first, then only what is set, in a fixed order, so the same list is the same address.
 * An empty search is left out (the API reads it as none).
 */
export function contentQueryString(query: ContentListQueryInput): string {
  const params = new URLSearchParams()
  params.set('type', query.type)
  if (query.status !== undefined && query.status !== 'all') {
    params.set('status', query.status)
  }
  if (query.author !== undefined) {
    params.set('author', query.author)
  }
  if (query.search !== undefined && query.search.trim() !== '') {
    params.set('search', query.search.trim())
  }
  if (query.month !== undefined) {
    params.set('month', query.month)
  }
  if (query.category !== undefined) {
    params.set('category', query.category)
  }
  if (query.tag !== undefined) {
    params.set('tag', query.tag)
  }
  if (query.orderby !== undefined) {
    params.set('orderby', query.orderby)
  }
  if (query.order !== undefined) {
    params.set('order', query.order)
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page))
  }
  if (query.per_page !== undefined) {
    params.set('per_page', String(query.per_page))
  }
  return params.toString()
}

/**
 * The content API (M1.1): posts and pages. Every answer is parsed with the shared schema; every failure is an ApiRequestError
 * (`invalid_blocks` carries the issues, `cannot_publish`, `content_trashed`, ... the reason).
 */
export function createContentApi(api: ApiCall) {
  const item = (id: string) => `${V1}/content/${encodeURIComponent(id)}`
  return {
    list: async (query: ContentListQueryInput) =>
      ContentListResponse.parse(await api(`${V1}/content?${contentQueryString(query)}`)),
    get: async (id: string) => ContentItem.parse(await api(item(id))),
    create: async (request: CreateContentRequest) =>
      ContentItem.parse(await api(`${V1}/content`, { method: 'POST', body: request })),
    update: async (id: string, request: UpdateContentRequest) =>
      ContentItem.parse(await api(item(id), { method: 'PATCH', body: request })),
    publish: async (id: string) => ContentItem.parse(await api(`${item(id)}/publish`, { method: 'POST' })),
    trash: async (id: string) => ContentItem.parse(await api(`${item(id)}/trash`, { method: 'POST' })),
    restore: async (id: string) => ContentItem.parse(await api(`${item(id)}/restore`, { method: 'POST' })),
    /** A signed address on the site that shows the item as stored, for a while (K-071). */
    previewLink: async (id: string) =>
      PreviewLinkResponse.parse(await api(`${item(id)}/preview-link`, { method: 'POST' })),
    /** Deletes a trashed item for good. */
    remove: async (id: string) => {
      await api(item(id), { method: 'DELETE' })
    },
    /** Who can be an author of the type (needs `edit_others_*`). */
    authors: async (type: ContentTypeKey) =>
      ContentAuthorsResponse.parse(await api(`${V1}/content/authors?type=${type}`)),
    bulk: async (request: ContentBulkRequest) =>
      ContentBulkResponse.parse(await api(`${V1}/content/bulk`, { method: 'POST', body: request })),
  }
}

export type ContentApi = ReturnType<typeof createContentApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useContentApi(): ContentApi {
  const { $api } = useNuxtApp()
  return createContentApi($api)
}
