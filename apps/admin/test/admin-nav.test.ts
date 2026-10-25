import type { AdminMenuEntry } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { isOnPath, sectionOf, toNavigationItems } from '../app/utils/admin-nav.ts'

// What `GET /api/v1/admin/menu` gives an administrator.
const ADMIN_MENU: AdminMenuEntry[] = [
  {
    id: 'dashboard',
    labelKey: 'menu.dashboard',
    icon: 'i-lucide-gauge',
    position: 2,
    to: '/',
    children: [{ id: 'dashboard.home', labelKey: 'menu.dashboardHome', to: '/' }],
  },
  {
    id: 'users',
    labelKey: 'menu.users',
    icon: 'i-lucide-users',
    position: 70,
    to: '/users',
    children: [
      { id: 'users.all', labelKey: 'menu.usersAll', to: '/users' },
      { id: 'users.profile', labelKey: 'menu.usersProfile', to: '/profile' },
    ],
  },
]

// What a subscriber gets: «Profil» as a top-level link with no sub-items.
const SUBSCRIBER_MENU: AdminMenuEntry[] = [
  ADMIN_MENU[0] as AdminMenuEntry,
  { id: 'profile', labelKey: 'menu.profile', icon: 'i-lucide-user', position: 70, to: '/profile', children: [] },
]

const label = (key: string) => `«${key}»`

describe('isOnPath', () => {
  it('matches the page itself and the pages below it', () => {
    expect(isOnPath('/users', '/users')).toBe(true)
    expect(isOnPath('/users/', '/users')).toBe(true)
    expect(isOnPath('/users/abc', '/users')).toBe(true)
    expect(isOnPath('/users?role=editor', '/users')).toBe(true)
  })

  it('does not match a path that only shares a prefix', () => {
    expect(isOnPath('/users-old', '/users')).toBe(false)
    expect(isOnPath('/profile', '/users')).toBe(false)
  })

  it('matches the start page on itself only', () => {
    expect(isOnPath('/', '/')).toBe(true)
    expect(isOnPath('/profile', '/')).toBe(false)
    expect(isOnPath('/users', '/')).toBe(false)
  })
})

describe('sectionOf', () => {
  it('finds the section by a sub-item or by its own path', () => {
    expect(sectionOf(ADMIN_MENU, '/')).toBe('dashboard')
    expect(sectionOf(ADMIN_MENU, '/users')).toBe('users')
    expect(sectionOf(ADMIN_MENU, '/users/42')).toBe('users')
    // «Profil» is a sub-item of «Brukere» for someone who sees both.
    expect(sectionOf(ADMIN_MENU, '/profile')).toBe('users')
    expect(sectionOf(SUBSCRIBER_MENU, '/profile')).toBe('profile')
  })

  it('finds none for a page the menu does not know', () => {
    expect(sectionOf(ADMIN_MENU, '/somewhere-else')).toBeUndefined()
    expect(sectionOf([], '/')).toBeUndefined()
  })
})

describe('toNavigationItems, expanded', () => {
  it("keeps the api's order, with each section's sub-items right after it, indented, and writes the labels from the keys", () => {
    const items = toNavigationItems(ADMIN_MENU, '/', label)
    expect(items.map((item) => item.label)).toEqual([
      '«menu.dashboard»',
      '«menu.dashboardHome»',
      '«menu.users»',
      '«menu.usersAll»',
      '«menu.usersProfile»',
    ])
    expect(items.map((item) => item.to)).toEqual(['/', '/', '/users', '/users', '/profile'])
    expect(items.map((item) => item.icon)).toEqual([
      'i-lucide-gauge',
      undefined,
      'i-lucide-users',
      undefined,
      undefined,
    ])
    expect(items.map((item) => item.class)).toEqual([undefined, 'ms-6', undefined, 'ms-6', 'ms-6'])
    expect(items.some((item) => item.children !== undefined)).toBe(false)
  })

  it('marks the current section and the current sub-item', () => {
    expect(toNavigationItems(ADMIN_MENU, '/profile', label).map((item) => item.active)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ])
    expect(toNavigationItems(ADMIN_MENU, '/users', label).map((item) => item.active)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ])
    expect(toNavigationItems(ADMIN_MENU, '/', label).map((item) => item.active)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })

  it('draws a plain link as one item', () => {
    const items = toNavigationItems(SUBSCRIBER_MENU, '/profile', label)
    expect(items.map((item) => item.label)).toEqual(['«menu.dashboard»', '«menu.dashboardHome»', '«menu.profile»'])
    expect(items.map((item) => item.active)).toEqual([false, false, true])
  })

  it('gives each item its id as its value', () => {
    expect(toNavigationItems(ADMIN_MENU, '/', label).map((item) => item.value)).toEqual([
      'dashboard',
      'dashboard.home',
      'users',
      'users.all',
      'users.profile',
    ])
  })

  it('draws an empty menu as an empty list', () => {
    expect(toNavigationItems([], '/', label)).toEqual([])
  })
})

describe('toNavigationItems, collapsed', () => {
  it('keeps the sub-items as children of their section, for the popover beside the rail', () => {
    const items = toNavigationItems(ADMIN_MENU, '/profile', label, true)
    expect(items.map((item) => item.label)).toEqual(['«menu.dashboard»', '«menu.users»'])
    expect(items[1]?.children?.map((child) => child.active)).toEqual([false, true])
    expect(items.map((item) => item.active)).toEqual([false, true])
  })

  it('gives a plain link no children', () => {
    const items = toNavigationItems(SUBSCRIBER_MENU, '/profile', label, true)
    expect(items[1]?.children).toBeUndefined()
  })
})
