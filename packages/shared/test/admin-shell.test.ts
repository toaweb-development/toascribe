import { describe, expect, it } from 'vitest'

import {
  ADMIN_COLOR_SCHEMES,
  AdminMenuItem,
  AdminPath,
  DEFAULT_PREFERENCES,
  MeResponse,
  NoticeKeyParams,
  Preferences,
  UpdatePreferencesRequest,
} from '../src/index.ts'

const ITEM = {
  id: 'reports',
  labelKey: 'menu.reports',
  icon: 'i-lucide-chart-bar',
  position: 60,
  capability: 'read',
  to: '/reports',
}

describe('AdminPath', () => {
  it.each(['/', '/users', '/users/', '/a/b-c/d_e', '/profile'])('accepts %s', (path) => {
    expect(AdminPath.safeParse(path).success).toBe(true)
  })
  it.each([
    '',
    'users',
    '//evil.example',
    '//x',
    'https://evil.example',
    '/a/../b',
    '/a/./b',
    '/a?x=1',
    '/a#b',
    '/a b',
    '/a\\b',
    '/a//b',
    '/%2e%2e',
  ])('refuses %j', (path) => {
    expect(AdminPath.safeParse(path).success).toBe(false)
  })
})

describe('AdminMenuItem', () => {
  it('accepts an item and gives it an empty list of children', () => {
    expect(AdminMenuItem.parse(ITEM).children).toEqual([])
  })
  it('accepts children and unlessCapability', () => {
    const parsed = AdminMenuItem.parse({
      ...ITEM,
      unlessCapability: 'list_users',
      children: [{ id: 'reports.all', labelKey: 'menu.reportsAll', to: '/reports', capability: 'read' }],
    })
    expect(parsed.children).toHaveLength(1)
    expect(parsed.unlessCapability).toBe('list_users')
  })
  it.each([
    ['an id with capitals', { id: 'Reports' }],
    ['an empty id', { id: '' }],
    ['a label with spaces', { labelKey: 'Show reports' }],
    ['an icon of another set', { icon: 'i-heroicons-home' }],
    ['a plain icon name', { icon: 'gauge' }],
    ['a negative position', { position: -1 }],
    ['an infinite position', { position: Number.POSITIVE_INFINITY }],
    ['an external path', { to: 'https://evil.example' }],
    ['a capability with a dash', { capability: 'manage-options' }],
    ['an unknown field', { extra: true }],
  ])('refuses %s', (_name, change) => {
    expect(AdminMenuItem.safeParse({ ...ITEM, ...change }).success).toBe(false)
  })
})

describe('Preferences', () => {
  it('lists the colour schemes', () => {
    expect(ADMIN_COLOR_SCHEMES).toEqual(['default', 'light', 'midnight', 'ocean'])
    expect(Preferences.safeParse(DEFAULT_PREFERENCES).success).toBe(true)
  })
  it('accepts a partial update and refuses an empty, unknown or mistyped one', () => {
    expect(UpdatePreferencesRequest.safeParse({ adminColorScheme: 'ocean' }).success).toBe(true)
    expect(UpdatePreferencesRequest.safeParse({}).success).toBe(false)
    expect(UpdatePreferencesRequest.safeParse({ adminColorScheme: 'pink' }).success).toBe(false)
    expect(UpdatePreferencesRequest.safeParse({ showToolbarOnSite: 'yes' }).success).toBe(false)
    expect(UpdatePreferencesRequest.safeParse({ somethingNew: 1 }).success).toBe(false)
  })
  it('is part of MeResponse', () => {
    expect(MeResponse.shape.preferences).toBe(Preferences)
  })
})

describe('NoticeKeyParams', () => {
  it.each(['setup.email_skipped', 'a-b_c.1'])('accepts %s', (key) => {
    expect(NoticeKeyParams.safeParse({ key }).success).toBe(true)
  })
  it.each(['', 'Upper', 'a b', 'a/b', 'x'.repeat(101)])('refuses %j', (key) => {
    expect(NoticeKeyParams.safeParse({ key }).success).toBe(false)
  })
})
