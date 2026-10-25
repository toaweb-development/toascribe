import { describe, expect, it } from 'vitest'

import {
  ASSIGN_ROLE_MAX_USERS,
  AssignRoleRequest,
  NO_ROLE_FILTER,
  USERS_DEFAULT_PER_PAGE,
  USERS_MAX_PER_PAGE,
  UserListQuery,
} from '../src/index.ts'

const ID_A = '0198a3c2-0000-7000-8000-000000000001'
const ID_B = '0198a3c2-0000-7000-8000-000000000002'

describe('UserListQuery', () => {
  it('fills in the defaults WordPress has', () => {
    expect(UserListQuery.parse({})).toEqual({
      orderby: 'username',
      order: 'asc',
      page: 1,
      perPage: USERS_DEFAULT_PER_PAGE,
    })
    expect(USERS_DEFAULT_PER_PAGE).toBe(20)
  })

  it('reads the numbers from the query string and trims the search', () => {
    expect(
      UserListQuery.parse({ search: '  kari  ', page: '3', perPage: '50', orderby: 'registered', order: 'desc' }),
    ).toEqual({
      search: 'kari',
      orderby: 'registered',
      order: 'desc',
      page: 3,
      perPage: 50,
    })
  })

  it('accepts a role slug and `none`', () => {
    expect(UserListQuery.parse({ role: 'editor' }).role).toBe('editor')
    expect(UserListQuery.parse({ role: NO_ROLE_FILTER }).role).toBe('none')
  })

  it.each([
    { perPage: String(USERS_MAX_PER_PAGE + 1) },
    { perPage: '0' },
    { page: '0' },
    { page: '1.5' },
    { page: 'x' },
    { orderby: 'password' },
    { order: 'up' },
    { role: 'Not A Slug' },
    { search: 'x'.repeat(101) },
    { unknown: '1' },
  ])('refuses %j', (query) => {
    expect(UserListQuery.safeParse(query).success).toBe(false)
  })
})

describe('AssignRoleRequest', () => {
  it('takes one to 100 distinct account ids and a role slug', () => {
    expect(AssignRoleRequest.parse({ userIds: [ID_A, ID_B], role: 'editor' })).toEqual({
      userIds: [ID_A, ID_B],
      role: 'editor',
    })
    const many = Array.from(
      { length: ASSIGN_ROLE_MAX_USERS },
      (_, i) => `0198a3c2-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    expect(AssignRoleRequest.safeParse({ userIds: many, role: 'editor' }).success).toBe(true)
  })

  it.each([
    {},
    { userIds: [], role: 'editor' },
    { userIds: [ID_A, ID_A], role: 'editor' },
    { userIds: ['nope'], role: 'editor' },
    { userIds: [ID_A], role: '' },
    { userIds: [ID_A], role: 'Editor' },
    { userIds: [ID_A], role: 'editor', extra: 1 },
  ])('refuses %j', (body) => {
    expect(AssignRoleRequest.safeParse(body).success).toBe(false)
  })

  it('refuses more than 100 accounts', () => {
    const tooMany = Array.from(
      { length: ASSIGN_ROLE_MAX_USERS + 1 },
      (_, i) => `0198a3c2-0000-7000-8000-${String(i).padStart(12, '0')}`,
    )
    expect(AssignRoleRequest.safeParse({ userIds: tooMany, role: 'editor' }).success).toBe(false)
  })
})
