import { TaxonomyListResponse, TermBulkResponse, TermItem, TermListResponse } from '@toascribe/shared'
import type {
  BuiltInTaxonomy,
  CreateTermRequest,
  TermBulkRequest,
  TermListQueryInput,
  UpdateTermRequest,
} from '@toascribe/shared'

import type { ApiCall } from './client.ts'

const V1 = '/v1'

/** The query string of `GET /taxonomies/{tax}/terms`: only what is set, in a fixed order. */
export function termsQueryString(query: TermListQueryInput): string {
  const params = new URLSearchParams()
  if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.orderby !== undefined) params.set('orderby', query.orderby)
  if (query.order !== undefined) params.set('order', query.order)
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.per_page !== undefined) params.set('per_page', String(query.per_page))
  return params.toString()
}

/** Categories and tags (M1.2). Reading needs a capability to edit content; changing needs `manage_categories`. */
export function createTermsApi(api: ApiCall) {
  const base = (tax: BuiltInTaxonomy) => `${V1}/taxonomies/${tax}/terms`
  return {
    taxonomies: async () => TaxonomyListResponse.parse(await api(`${V1}/taxonomies`)),
    list: async (tax: BuiltInTaxonomy, query: TermListQueryInput = {}) => {
      const search = termsQueryString(query)
      return TermListResponse.parse(await api(search === '' ? base(tax) : `${base(tax)}?${search}`))
    },
    /** Every term of the taxonomy, page by page (100 a page): for the pickers. */
    all: async (tax: BuiltInTaxonomy) => {
      const items: TermItem[] = []
      for (let page = 1; ; page += 1) {
        const answer = TermListResponse.parse(await api(`${base(tax)}?${termsQueryString({ page, per_page: 100 })}`))
        items.push(...answer.items)
        if (page >= answer.totalPages) return items
      }
    },
    create: async (tax: BuiltInTaxonomy, request: CreateTermRequest) =>
      TermItem.parse(await api(base(tax), { method: 'POST', body: request })),
    update: async (tax: BuiltInTaxonomy, id: string, request: UpdateTermRequest) =>
      TermItem.parse(await api(`${base(tax)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: request })),
    remove: async (tax: BuiltInTaxonomy, id: string) => {
      await api(`${base(tax)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    bulk: async (tax: BuiltInTaxonomy, request: TermBulkRequest) =>
      TermBulkResponse.parse(await api(`${base(tax)}/bulk`, { method: 'POST', body: request })),
  }
}

export type TermsApi = ReturnType<typeof createTermsApi>

/** Call synchronously in setup, a plugin or middleware: it needs the Nuxt context. */
export function useTermsApi(): TermsApi {
  const { $api } = useNuxtApp()
  return createTermsApi($api)
}
