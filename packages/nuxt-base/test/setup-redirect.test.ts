import { describe, expect, it } from 'vitest'

import { ADMIN_SETUP_ADDRESS, decideSetupRedirect } from '../app/lib/setup/redirect.ts'
import type { SetupRedirectInput } from '../app/lib/setup/redirect.ts'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 characters, as the api makes them

const base: SetupRedirectInput = { installed: false, hostsWizard: true, path: '/' }

describe('before the install', () => {
  it('sends every page of the admin to the wizard', () => {
    for (const path of ['/', '/login', '/login/', '/register', '/logout', '/anything/else']) {
      expect(decideSetupRedirect({ ...base, path })).toEqual({ kind: 'route', to: { path: '/setup' } })
    }
  })

  it('sends every page of the site to the wizard in the admin, as a full page load', () => {
    for (const path of ['/', '/blog', '/some/deep/page']) {
      expect(decideSetupRedirect({ ...base, hostsWizard: false, path })).toEqual({
        kind: 'external',
        href: ADMIN_SETUP_ADDRESS,
      })
    }
  })

  it('shows the wizard itself, with or without a trailing slash: it is the one page that never goes anywhere', () => {
    expect(decideSetupRedirect({ ...base, path: '/setup' })).toEqual({ kind: 'none' })
    expect(decideSetupRedirect({ ...base, path: '/setup/' })).toEqual({ kind: 'none' })
  })

  it('does not loop: the site never treats /setup as the wizard, and the wizard page never redirects', () => {
    // The site has no wizard page of its own: /setup there is any other page and goes to the admin (the proxy sends /setup
    // to /admin/setup before it reaches the site at all).
    expect(decideSetupRedirect({ ...base, hostsWizard: false, path: '/setup' }).kind).toBe('external')
    expect(decideSetupRedirect({ ...base, path: '/setup' }).kind).toBe('none')
  })

  it('carries nothing of the address on: no query, and no setup code (it is in the fragment, which stays with the browser)', () => {
    expect(
      decideSetupRedirect({
        ...base,
        path: '/login',
        query: { token: TOKEN, action: 'register' },
      } as SetupRedirectInput),
    ).toEqual({ kind: 'route', to: { path: '/setup' } })
    expect(decideSetupRedirect({ ...base, hostsWizard: false, query: { token: TOKEN } } as SetupRedirectInput)).toEqual(
      {
        kind: 'external',
        href: ADMIN_SETUP_ADDRESS,
      },
    )
    expect(JSON.stringify(decideSetupRedirect({ ...base, path: '/login' }))).not.toContain('token')
  })
})

describe('after the install', () => {
  const installed = { ...base, installed: true }

  it('sends no page anywhere', () => {
    for (const path of ['/', '/login', '/register', '/blog']) {
      expect(decideSetupRedirect({ ...installed, path })).toEqual({ kind: 'none' })
      expect(decideSetupRedirect({ ...installed, hostsWizard: false, path })).toEqual({ kind: 'none' })
    }
  })

  it('answers the wizard with a 404', () => {
    expect(decideSetupRedirect({ ...installed, path: '/setup' })).toEqual({ kind: 'not-found' })
    expect(decideSetupRedirect({ ...installed, path: '/setup/' })).toEqual({ kind: 'not-found' })
  })

  it('leaves /setup of the site alone: the site has no wizard', () => {
    expect(decideSetupRedirect({ ...installed, hostsWizard: false, path: '/setup' })).toEqual({ kind: 'none' })
  })
})
