import { describe, expect, it, vi } from 'vitest'

import { createTermsApi, termsQueryString } from '../app/lib/api/terms.ts'

const ID = '01a15f9a-26a2-73d3-8aad-c6b671836b33'
const TERM = {
  id: ID,
  taxonomy: 'category',
  name: 'Mat',
  slug: 'mat',
  description: '',
  parentId: null,
  count: 2,
  depth: 0,
  isDefault: false,
}
const page = (n: number, totalPages: number) => ({
  items: [{ ...TERM, name: `T${String(n)}` }],
  total: totalPages,
  totalPages,
  page: n,
  perPage: 100,
})

describe('the terms API layer', () => {
  it('builds the query string from what is set', () => {
    expect(termsQueryString({})).toBe('')
    expect(termsQueryString({ search: ' mat ', orderby: 'count', order: 'desc', page: 2, per_page: 50 })).toBe(
      'search=mat&orderby=count&order=desc&page=2&per_page=50',
    )
  })

  it('reads every page for the pickers', async () => {
    const api = vi.fn().mockResolvedValueOnce(page(1, 2)).mockResolvedValueOnce(page(2, 2))
    const all = await createTermsApi(api).all('category')
    expect(all.map((term) => term.name)).toEqual(['T1', 'T2'])
    expect(api).toHaveBeenNthCalledWith(2, '/v1/taxonomies/category/terms?page=2&per_page=100')
  })

  it('makes, changes and deletes with the right method and path', async () => {
    const api = vi.fn().mockResolvedValueOnce(TERM).mockResolvedValueOnce(TERM).mockResolvedValueOnce(undefined)
    const terms = createTermsApi(api)
    await terms.create('post_tag', { name: 'Mat' })
    await terms.update('category', ID, { name: 'Mat' })
    await terms.remove('category', ID)
    expect(api.mock.calls).toEqual([
      ['/v1/taxonomies/post_tag/terms', { method: 'POST', body: { name: 'Mat' } }],
      [`/v1/taxonomies/category/terms/${ID}`, { method: 'PATCH', body: { name: 'Mat' } }],
      [`/v1/taxonomies/category/terms/${ID}`, { method: 'DELETE' }],
    ])
  })
})
