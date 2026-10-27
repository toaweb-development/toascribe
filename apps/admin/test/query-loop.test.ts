import { describe, expect, it } from 'vitest'

import { queryLoopQuery, queryLoopSummary } from '../app/utils/query-loop.ts'

const t = (key: string, values?: Record<string, unknown>) =>
  `${key}${values === undefined ? '' : JSON.stringify(values)}`

describe('the Query Loop block (K-085)', () => {
  it('asks the public api for what its attributes say, with the defaults of its block.json', () => {
    expect(queryLoopQuery({})).toEqual({ type: 'post', per_page: 5, orderby: 'date', order: 'desc' })
    expect(
      queryLoopQuery({
        postType: 'post',
        perPage: 3,
        category: 'mat',
        tag: 'fisk',
        orderBy: 'title',
        order: 'asc',
        sticky: 'first',
      }),
    ).toEqual({
      type: 'post',
      per_page: 3,
      orderby: 'title',
      order: 'asc',
      category: 'mat',
      tag: 'fisk',
      sticky_first: 'true',
    })
    expect(queryLoopQuery({ sticky: 'exclude' })).toMatchObject({ exclude_sticky: 'true' })
  })

  it('says in a sentence what it lists', () => {
    expect(queryLoopSummary(t, { category: 'mat' })).toBe(
      'editor.query.newest editor.query.posts{"n":5} editor.query.inCategory{"slug":"mat"}',
    )
  })
})
