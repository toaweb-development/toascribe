import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONTENT_VIEW,
  ariaSortOfContent,
  changeContentView,
  contentViewQuery,
  parseContentView,
  sortContentBy,
  toContentListQuery,
} from '../app/utils/content-query.ts'

const ME = '01a15f9a-26a2-73d3-8aad-c6b671836b33'

describe('the content list address', () => {
  it('reads the defaults from an empty address and ignores what it does not understand', () => {
    expect(parseContentView({})).toEqual(DEFAULT_CONTENT_VIEW)
    expect(
      parseContentView({
        status: 'deleted',
        author: 'someone',
        month: '2026-13',
        orderby: 'author',
        order: 'up',
        page: 'x',
      }),
    ).toEqual(DEFAULT_CONTENT_VIEW)
  })

  it('round-trips a view through the address, with only what differs from the default', () => {
    const view = {
      ...DEFAULT_CONTENT_VIEW,
      status: 'trash' as const,
      mine: true,
      search: 'blåbær',
      month: '2026-10',
      page: 3,
    }
    const query = contentViewQuery(view)
    expect(query).toEqual({ status: 'trash', author: 'mine', search: 'blåbær', month: '2026-10', page: '3' })
    expect(parseContentView(query)).toEqual(view)
    expect(contentViewQuery(DEFAULT_CONTENT_VIEW)).toEqual({})
  })

  it('asks the API for the view, with «Mine» as the signed-in account', () => {
    const view = { ...DEFAULT_CONTENT_VIEW, mine: true, search: 'x', page: 2 }
    expect(toContentListQuery(view, 'post', ME, 20)).toEqual({
      type: 'post',
      status: 'all',
      author: ME,
      search: 'x',
      page: 2,
      per_page: 20,
    })
  })

  it('starts on page 1 after any change but a change of page', () => {
    const view = { ...DEFAULT_CONTENT_VIEW, page: 4 }
    expect(changeContentView(view, { search: 'a' }).page).toBe(1)
    expect(changeContentView(view, { page: 5 }).page).toBe(5)
  })

  it('sorts posts by date (newest first) by default, flips a sorted column and starts another in its own order', () => {
    expect(ariaSortOfContent(DEFAULT_CONTENT_VIEW, 'post', 'date')).toBe('descending')
    expect(ariaSortOfContent(DEFAULT_CONTENT_VIEW, 'page', 'date')).toBe('none')
    const byDate = sortContentBy(DEFAULT_CONTENT_VIEW, 'post', 'date')
    expect([byDate.orderby, byDate.order]).toEqual(['date', 'asc'])
    const byTitle = sortContentBy(DEFAULT_CONTENT_VIEW, 'post', 'title')
    expect([byTitle.orderby, byTitle.order]).toEqual(['title', 'asc'])
  })
})
