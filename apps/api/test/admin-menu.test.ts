// The admin menu registry (M0.5): what each role sees, the `unlessCapability` rule, the order, a bad item refused, and the route.
import { DEFAULT_ROLES, AdminMenuResponse } from '@toascribe/shared'
import type { AdminMenuItemInput, BuiltInRole } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAdminMenuRegistry, createCoreAdminMenu, CORE_MENU_ITEMS } from '../src/services/admin-menu.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { TEST_PASSWORD, startAuthApp } from './harness.ts'
import type { AuthTestApp } from './harness.ts'
import { UNREACHABLE_DATABASE_URL, makeApp } from './helpers.ts'

noticeIfSkipped('admin-menu')

/** The capabilities a built-in role really has. */
function held(role: BuiltInRole): ReadonlySet<string> {
  const found = DEFAULT_ROLES.find((r) => r.slug === role)
  if (found === undefined) {
    throw new Error(`no role ${role}`)
  }
  return new Set(found.capabilities)
}

const shape = (role: BuiltInRole) =>
  createCoreAdminMenu()
    .forCapabilities(held(role))
    .map((item) => ({ id: item.id, to: item.to, children: item.children.map((child) => child.id) }))

describe('the core menu', () => {
  it('shows an administrator Kontrollpanel, Innlegg, Media, Sider, Brukere and Innstillinger, and not the top-level Profil', () => {
    expect(shape('administrator')).toEqual([
      { id: 'dashboard', to: '/', children: ['dashboard.home'] },
      { id: 'posts', to: '/posts', children: ['posts.all', 'posts.new', 'posts.categories', 'posts.tags'] },
      { id: 'media', to: '/media', children: ['media.library', 'media.new'] },
      { id: 'pages', to: '/pages', children: ['pages.all', 'pages.new'] },
      { id: 'users', to: '/users', children: ['users.all', 'users.profile'] },
      { id: 'settings', to: '/settings/media', children: ['settings.media'] },
    ])
  })

  it('shows an editor Innlegg (with Kategorier and Stikkord), Media and Sider; an author Innlegg and Media; a contributor Innlegg', () => {
    const dashboard = { id: 'dashboard', to: '/', children: ['dashboard.home'] }
    const profile = { id: 'profile', to: '/profile', children: [] }
    expect(shape('editor')).toEqual([
      dashboard,
      { id: 'posts', to: '/posts', children: ['posts.all', 'posts.new', 'posts.categories', 'posts.tags'] },
      { id: 'media', to: '/media', children: ['media.library', 'media.new'] },
      { id: 'pages', to: '/pages', children: ['pages.all', 'pages.new'] },
      profile,
    ])
    expect(shape('author')).toEqual([
      dashboard,
      { id: 'posts', to: '/posts', children: ['posts.all', 'posts.new'] },
      { id: 'media', to: '/media', children: ['media.library', 'media.new'] },
      profile,
    ])
    expect(shape('contributor')).toEqual([
      dashboard,
      { id: 'posts', to: '/posts', children: ['posts.all', 'posts.new'] },
      profile,
    ])
  })

  it('shows a subscriber Kontrollpanel and Profil as a top-level item (no list_users, no edit_posts)', () => {
    expect(shape('subscriber')).toEqual([
      { id: 'dashboard', to: '/', children: ['dashboard.home'] },
      { id: 'profile', to: '/profile', children: [] },
    ])
  })

  it('shows nothing to an account that holds no capability', () => {
    expect(createCoreAdminMenu().forCapabilities(new Set())).toEqual([])
  })

  it('leaves out a parent whose sub-items are all hidden, but keeps a link that has none', () => {
    const registry = createAdminMenuRegistry()
    registry.register({
      id: 'tools',
      labelKey: 'menu.tools',
      icon: 'i-lucide-wrench',
      position: 75,
      capability: 'read',
      to: '/tools',
      children: [{ id: 'tools.import', labelKey: 'menu.toolsImport', capability: 'import', to: '/tools/import' }],
    })
    registry.register({
      id: 'plain',
      labelKey: 'menu.plain',
      icon: 'i-lucide-circle',
      position: 80,
      capability: 'read',
      to: '/plain',
    })
    expect(registry.forCapabilities(new Set(['read'])).map((item) => item.id)).toEqual(['plain'])
    expect(registry.forCapabilities(new Set(['read', 'import'])).map((item) => item.id)).toEqual(['tools', 'plain'])
  })

  it('has WordPress positions and Lucide icons, and nothing that is not built', () => {
    const byId = new Map(CORE_MENU_ITEMS.map((item) => [item.id, item]))
    expect(byId.get('dashboard')).toMatchObject({ position: 2, icon: 'i-lucide-gauge' })
    expect(byId.get('posts')).toMatchObject({ position: 5, icon: 'i-lucide-pin', capability: 'edit_posts' })
    expect(byId.get('media')).toMatchObject({ position: 10, icon: 'i-lucide-image', capability: 'upload_files' })
    expect(byId.get('settings')).toMatchObject({ position: 80, icon: 'i-lucide-settings', capability: 'manage_options' })
    expect(byId.get('pages')).toMatchObject({ position: 20, icon: 'i-lucide-file-text', capability: 'edit_pages' })
    expect(byId.get('users')).toMatchObject({ position: 70, icon: 'i-lucide-users' })
    expect(byId.get('profile')).toMatchObject({ position: 70, icon: 'i-lucide-user', unlessCapability: 'list_users' })
    expect(CORE_MENU_ITEMS.flatMap((item) => (item.children ?? []).map((child) => child.id))).toEqual([
      'dashboard.home',
      'posts.all',
      'posts.new',
      'posts.categories',
      'posts.tags',
      'media.library',
      'media.new',
      'pages.all',
      'pages.new',
      'users.all',
      'users.profile',
      'settings.media',
    ])
  })
})

describe('the registry', () => {
  const item = (id: string, position: number, extra: Partial<AdminMenuItemInput> = {}): AdminMenuItemInput => ({
    id,
    labelKey: `menu.${id}`,
    icon: 'i-lucide-circle',
    position,
    capability: 'read',
    to: `/${id}`,
    ...extra,
  })

  it('sorts by position, and keeps registration order for equal positions', () => {
    const registry = createAdminMenuRegistry()
    registry.register(item('late', 80))
    registry.register(item('first-of-two', 40))
    registry.register(item('early', 5))
    registry.register(item('second-of-two', 40))
    registry.register(item('between', 40.5))
    expect(registry.forCapabilities(new Set(['read'])).map((entry) => entry.id)).toEqual([
      'early',
      'first-of-two',
      'second-of-two',
      'between',
      'late',
    ])
  })

  it('lets an extension register after core, and the item shows to those with its capability only', () => {
    const registry = createCoreAdminMenu()
    registry.register(item('reports', 60, { capability: 'view_reports' }))
    expect(registry.forCapabilities(held('administrator')).map((entry) => entry.id)).not.toContain('reports')
    expect(registry.forCapabilities(new Set(['read', 'view_reports'])).map((entry) => entry.id)).toContain('reports')
  })

  it.each([
    ['an external path', item('a', 1, { to: 'https://evil.example/' })],
    ['a protocol-relative path', item('a', 1, { to: '//evil.example' })],
    ['a path that climbs', item('a', 1, { to: '/a/../b' })],
    ['a label that is text', item('a', 1, { labelKey: 'Show reports' })],
    ['an icon of another set', item('a', 1, { icon: 'i-heroicons-home' })],
    ['a capability that is not a name', item('a', 1, { capability: 'Manage Options' })],
    ['an id with capitals', item('Reports', 1)],
    [
      'a child with a bad path',
      item('a', 1, { children: [{ id: 'a.b', labelKey: 'menu.b', capability: 'read', to: 'x' }] }),
    ],
  ])('refuses %s, without echoing it', (_name, bad) => {
    const registry = createAdminMenuRegistry()
    expect(() => {
      registry.register(bad)
    }).toThrow(/invalid admin menu item/)
    expect(registry.forCapabilities(new Set(['read']))).toEqual([])
  })

  it('refuses an id that is taken, by an item or a child, and an item that repeats its own child id', () => {
    const registry = createAdminMenuRegistry()
    registry.register(item('a', 1, { children: [{ id: 'a.one', labelKey: 'menu.one', capability: 'read', to: '/a' }] }))
    expect(() => {
      registry.register(item('a', 2))
    }).toThrow(/already registered: a/)
    expect(() => {
      registry.register(
        item('b', 2, { children: [{ id: 'a.one', labelKey: 'menu.one', capability: 'read', to: '/b' }] }),
      )
    }).toThrow(/already registered: a.one/)
    expect(() => {
      registry.register(
        item('c', 3, {
          children: [
            { id: 'c.x', labelKey: 'menu.x', capability: 'read', to: '/c' },
            { id: 'c.x', labelKey: 'menu.x', capability: 'read', to: '/c' },
          ],
        }),
      )
    }).toThrow(/already registered: c.x/)
    // A refused item leaves nothing behind: its id can be used.
    registry.register(item('b', 2))
    expect(registry.forCapabilities(new Set(['read'])).map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

describe('GET /api/v1/admin/menu without a session', () => {
  it('answers 401', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const res = await app.request('/api/v1/admin/menu')
    expect(res.status).toBe(401)
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('GET /api/v1/admin/menu (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  async function menuAs(role: BuiltInRole) {
    const account = await env.createAccount({ username: `menu-${role}`, role })
    const client = env.client()
    await client.login(account.username, TEST_PASSWORD)
    const res = await client.get('/api/v1/admin/menu')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    return AdminMenuResponse.parse(await res.json()).items
  }

  it('gives an administrator the Brukere menu', async () => {
    const items = await menuAs('administrator')
    expect(items.map((entry) => entry.id)).toEqual(['dashboard', 'posts', 'media', 'pages', 'users', 'settings'])
    expect(items[4]).toEqual({
      id: 'users',
      labelKey: 'menu.users',
      icon: 'i-lucide-users',
      position: 70,
      to: '/users',
      children: [
        { id: 'users.all', labelKey: 'menu.usersAll', to: '/users' },
        { id: 'users.profile', labelKey: 'menu.usersProfile', to: '/profile' },
      ],
    })
  })

  it('gives an editor and a subscriber Profil on its own, with no capability rules in the answer', async () => {
    expect((await menuAs('editor')).map((entry) => entry.id)).toEqual(['dashboard', 'posts', 'media', 'pages', 'profile'])
    const items = await menuAs('subscriber')
    expect(items.map((entry) => entry.id)).toEqual(['dashboard', 'profile'])
    expect(JSON.stringify(items)).not.toMatch(/capability|unless/i)
  })

  it('follows a change of roles at once', async () => {
    const account = await env.createAccount({ username: 'menu-promoted', role: 'subscriber' })
    const client = env.client()
    await client.login(account.username, TEST_PASSWORD)
    const before = AdminMenuResponse.parse(await (await client.get('/api/v1/admin/menu')).json())
    expect(before.items.map((entry) => entry.id)).toEqual(['dashboard', 'profile'])
    await env.query(
      `insert into account_role (account_id, role_id) select $1, id from role where slug = 'administrator'`,
      [account.id],
    )
    const after = AdminMenuResponse.parse(await (await client.get('/api/v1/admin/menu')).json())
    expect(after.items.map((entry) => entry.id)).toEqual(['dashboard', 'posts', 'media', 'pages', 'users', 'settings'])
  })
})
