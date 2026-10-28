import { describe, expect, it, vi } from 'vitest'

import { createUsersApi, usersQueryString } from '../app/lib/api/users.ts'

const ID_A = '01a15f9a-26a2-73d3-8aad-c6b671836b33'
const ID_B = '01a15f9a-26a2-73d3-8aad-c6b671836b34'

const LIST = {
  users: [
    {
      id: ID_A,
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@example.test',
      roles: ['editor'],
      status: 'active',
      registeredAt: '2026-10-24T08:00:00.000Z',
      avatarUrl: null,
      postCount: 3,
    },
  ],
  total: 1,
  page: 1,
  perPage: 20,
  roleCounts: { all: 1, none: 0, roles: { editor: 1 } },
  roles: [{ slug: 'editor', name: 'Editor', grantable: true }],
}

const BASE = { orderby: 'username', order: 'asc', page: 1, per_page: 20 } as const

describe('the users query string', () => {
  it('always sends the sort and the page, and leaves out an empty search and role', () => {
    expect(usersQueryString({ ...BASE })).toBe('orderby=username&order=asc&page=1&per_page=20')
    expect(usersQueryString({ ...BASE, search: '   ', role: '' })).toBe('orderby=username&order=asc&page=1&per_page=20')
  })

  it('puts search and role first and encodes them', () => {
    expect(
      usersQueryString({ ...BASE, search: ' a&b %_ ', role: 'none', orderby: 'email', order: 'desc', page: 3 }),
    ).toBe('search=a%26b+%25_&role=none&orderby=email&order=desc&page=3&per_page=20')
  })
})

describe('the users API layer', () => {
  it('lists with a GET and parses the answer', async () => {
    const api = vi.fn().mockResolvedValue(LIST)
    const answer = await createUsersApi(api).list({ ...BASE, role: 'editor' })
    expect(answer.users[0]?.username).toBe('alice')
    expect(answer.roleCounts.roles).toEqual({ editor: 1 })
    expect(api).toHaveBeenCalledWith('/v1/users?role=editor&orderby=username&order=asc&page=1&per_page=20')
  })

  it('refuses a list that is not the shared shape', async () => {
    const users = createUsersApi(vi.fn().mockResolvedValue({ users: [{ id: 'x' }] }))
    await expect(users.list({ ...BASE })).rejects.toThrow()
  })

  it('assigns a role with a PUT and parses the three lists', async () => {
    const api = vi.fn().mockResolvedValue({ changed: [ID_A], unchanged: [], skipped: [{ id: ID_B, reason: 'self' }] })
    const answer = await createUsersApi(api).assignRole({ userIds: [ID_A, ID_B], role: 'author' })
    expect(answer.skipped).toEqual([{ id: ID_B, reason: 'self' }])
    expect(api).toHaveBeenCalledWith('/v1/users/roles', {
      method: 'PUT',
      body: { userIds: [ID_A, ID_B], role: 'author' },
    })
  })

  it('refuses an answer with a reason the API does not have', async () => {
    const api = vi.fn().mockResolvedValue({ changed: [], unchanged: [], skipped: [{ id: ID_A, reason: 'because' }] })
    await expect(createUsersApi(api).assignRole({ userIds: [ID_A], role: 'author' })).rejects.toThrow()
  })
})
