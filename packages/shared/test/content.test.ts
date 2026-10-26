import { describe, expect, it } from 'vitest'

import {
  ContentBulkRequest,
  ContentListQuery,
  CreateContentRequest,
  UpdateContentRequest,
  shortLinkOf,
  textSearchConfig,
} from '../src/index.ts'

const ID = '0198a3c2-0000-7000-8000-000000000001'

describe('content schemas', () => {
  it('fills in the list defaults and refuses unknown parameters', () => {
    expect(ContentListQuery.parse({ type: 'post' })).toEqual({ type: 'post', status: 'all', page: 1, per_page: 20 })
    expect(ContentListQuery.safeParse({ type: 'post', perPage: '5' }).success).toBe(false)
    expect(ContentListQuery.safeParse({ type: 'attachment' }).success).toBe(false)
    expect(ContentListQuery.safeParse({ type: 'post', per_page: '101' }).success).toBe(false)
    expect(ContentListQuery.safeParse({ type: 'post', month: '2026-13' }).success).toBe(false)
    expect(ContentListQuery.parse({ type: 'page', status: 'trash', month: '2026-10', per_page: '5' })).toMatchObject({
      status: 'trash',
      month: '2026-10',
      per_page: 5,
    })
  })

  it('never lets a request set the trash status', () => {
    expect(CreateContentRequest.safeParse({ type: 'post', status: 'trash' }).success).toBe(false)
    expect(UpdateContentRequest.safeParse({ status: 'trash' }).success).toBe(false)
    expect(UpdateContentRequest.safeParse({ status: 'future' }).success).toBe(true)
  })

  it('wants at least one field in a change, and each author once', () => {
    expect(UpdateContentRequest.safeParse({}).success).toBe(false)
    expect(UpdateContentRequest.safeParse({ authors: [ID, ID] }).success).toBe(false)
    expect(UpdateContentRequest.safeParse({ authors: [] }).success).toBe(false)
    expect(CreateContentRequest.parse({ type: 'page' })).toEqual({ type: 'page' })
  })

  it('tells the bulk actions apart', () => {
    expect(ContentBulkRequest.safeParse({ action: 'trash', ids: [ID] }).success).toBe(true)
    expect(ContentBulkRequest.safeParse({ action: 'edit', ids: [ID], changes: {} }).success).toBe(false)
    expect(ContentBulkRequest.safeParse({ action: 'edit', ids: [ID], changes: { status: 'trash' } }).success).toBe(
      false,
    )
    expect(ContentBulkRequest.safeParse({ action: 'empty_trash', type: 'post' }).success).toBe(true)
    expect(ContentBulkRequest.safeParse({ action: 'empty_trash', ids: [ID] }).success).toBe(false)
  })

  it('builds the short link and picks the search configuration', () => {
    expect(shortLinkOf(17)).toBe('/?p=17')
    expect(textSearchConfig('nb')).toBe('norwegian')
    expect(textSearchConfig('nn-NO')).toBe('norwegian')
    expect(textSearchConfig('en-GB')).toBe('english')
    expect(textSearchConfig('sv')).toBe('simple')
  })
})
