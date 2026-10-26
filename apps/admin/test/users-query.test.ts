import { UserListQuery } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USERS_VIEW,
  ariaSortOf,
  changeUsersView,
  pageCountOf,
  parseUsersView,
  sortUsersBy,
  toUserListQuery,
  usersViewQuery,
} from '../app/utils/users-query.ts'
import type { UsersView } from '../app/utils/users-query.ts'

function view(changes: Partial<UsersView> = {}): UsersView {
  return { ...DEFAULT_USERS_VIEW, ...changes }
}

describe('reading the address', () => {
  it('gives the default list for an address with nothing in it', () => {
    expect(parseUsersView({})).toEqual(DEFAULT_USERS_VIEW)
  })

  it('reads every parameter', () => {
    expect(parseUsersView({ role: 'editor', search: ' anna ', orderby: 'email', order: 'desc', page: '3' })).toEqual({
      role: 'editor',
      search: 'anna',
      orderby: 'email',
      order: 'desc',
      page: 3,
    })
  })

  it('knows the view for accounts without a role', () => {
    expect(parseUsersView({ role: 'none' }).role).toBe('none')
  })

  it('ignores what it does not understand, as WordPress does, instead of failing', () => {
    expect(
      parseUsersView({ role: 'Not A Slug!', orderby: 'registered', order: 'sideways', page: '-2', search: undefined }),
    ).toEqual(DEFAULT_USERS_VIEW)
    expect(parseUsersView({ page: '0' }).page).toBe(1)
    expect(parseUsersView({ page: '2.5' }).page).toBe(1)
    expect(parseUsersView({ page: 'abc' }).page).toBe(1)
    expect(parseUsersView({ page: '9999999' }).page).toBe(1_000_000)
    expect(parseUsersView({ page: '99999999' }).page).toBe(1)
  })

  it('takes the first of a repeated parameter and nothing from a bare one', () => {
    expect(parseUsersView({ role: ['author', 'editor'], search: [null] })).toEqual({
      ...DEFAULT_USERS_VIEW,
      role: 'author',
    })
    expect(parseUsersView({ role: null, page: null }).role).toBeUndefined()
  })

  it('cuts a search at the length the API accepts, so the request is never a 400 for it', () => {
    const search = parseUsersView({ search: 'x'.repeat(300) }).search
    expect(search).toHaveLength(100)
    expect(UserListQuery.safeParse(toUserListQuery(parseUsersView({ search: 'x'.repeat(300) }))).success).toBe(true)
  })
})

describe('writing the address', () => {
  it('leaves out what is the default, so the plain list has a plain address', () => {
    expect(usersViewQuery(DEFAULT_USERS_VIEW)).toEqual({})
  })

  it('keeps what differs', () => {
    expect(usersViewQuery(view({ role: 'none', search: 'anna', orderby: 'name', order: 'desc', page: 2 }))).toEqual({
      role: 'none',
      search: 'anna',
      orderby: 'name',
      order: 'desc',
      page: '2',
    })
  })

  it('round-trips through the parser', () => {
    const states = [
      view(),
      view({ role: 'subscriber', page: 4 }),
      view({ search: 'æøå & % _', orderby: 'email' }),
      view({ order: 'desc', orderby: 'name', role: 'none' }),
    ]
    for (const state of states) {
      expect(parseUsersView(usersViewQuery(state))).toEqual(state)
    }
  })
})

describe('the request to the API', () => {
  it('is a valid UserListQuery for any state the address can stand for', () => {
    const states = [view(), view({ role: 'none', search: 'a', orderby: 'email', order: 'desc', page: 7 })]
    for (const state of states) {
      expect(UserListQuery.safeParse(toUserListQuery(state)).success).toBe(true)
    }
  })

  it('leaves search and role out when there are none and always sends the page size', () => {
    expect(toUserListQuery(DEFAULT_USERS_VIEW)).toEqual({ orderby: 'username', order: 'asc', page: 1, per_page: 20 })
    expect(toUserListQuery(view({ role: 'author', search: 'x' }), 50)).toEqual({
      search: 'x',
      role: 'author',
      orderby: 'username',
      order: 'asc',
      page: 1,
      per_page: 50,
    })
  })
})

describe('changing the state', () => {
  it('starts on the first page when the view, the search or the sort changes', () => {
    const state = view({ page: 4, role: 'editor' })
    expect(changeUsersView(state, { role: 'author' }).page).toBe(1)
    expect(changeUsersView(state, { search: 'x' }).page).toBe(1)
  })

  it('keeps everything else, the search and the sort included', () => {
    const state = view({ page: 4, search: 'anna', orderby: 'email', order: 'desc' })
    expect(changeUsersView(state, { role: 'none' })).toEqual({ ...state, role: 'none', page: 1 })
  })

  it('moves to the page it is told to', () => {
    expect(changeUsersView(view({ page: 2, search: 'a' }), { page: 5 })).toEqual(view({ page: 5, search: 'a' }))
  })

  it('sorts a new column ascending and flips the column it is sorted by', () => {
    expect(sortUsersBy(view(), 'email')).toEqual(view({ orderby: 'email', order: 'asc' }))
    expect(sortUsersBy(view({ orderby: 'email', order: 'asc' }), 'email')).toEqual(
      view({ orderby: 'email', order: 'desc' }),
    )
    expect(sortUsersBy(view({ orderby: 'email', order: 'desc' }), 'email')).toEqual(
      view({ orderby: 'email', order: 'asc' }),
    )
    // The default sort is by username, ascending: the first click on it flips it.
    expect(sortUsersBy(view(), 'username')).toEqual(view({ order: 'desc' }))
    expect(sortUsersBy(view({ orderby: 'email', order: 'desc' }), 'name')).toEqual(
      view({ orderby: 'name', order: 'asc' }),
    )
  })

  it('starts the sorted list on the first page', () => {
    expect(sortUsersBy(view({ page: 3 }), 'name').page).toBe(1)
  })

  it('says what aria-sort says for each column', () => {
    const state = view({ orderby: 'name', order: 'desc' })
    expect(ariaSortOf(state, 'name')).toBe('descending')
    expect(ariaSortOf(state, 'email')).toBe('none')
    expect(ariaSortOf(view(), 'username')).toBe('ascending')
  })
})

describe('the pages', () => {
  it('counts at least one page, also for an empty list', () => {
    expect(pageCountOf(0, 20)).toBe(1)
    expect(pageCountOf(20, 20)).toBe(1)
    expect(pageCountOf(21, 20)).toBe(2)
    expect(pageCountOf(101, 20)).toBe(6)
  })
})
