import { DEFAULT_REDIRECT, safeRedirectPath } from '@toascribe/shared'

// Where the sign-in screens send a person next. Every target goes through the shared `safeRedirectPath` (security §4): a
// path on this site and nothing else. The admin lives under a base path (`/admin`), so a target is either a route of this
// app or, for a path outside it, a full page load.

/** The query names that carry the target: ours, and WordPress' (`wp-login.php?redirect_to=...`). */
const REDIRECT_QUERY_NAMES = ['redirectTo', 'redirect_to'] as const

/** The target in the address, if it is a safe path. `undefined` when there is none, so the caller can leave it out. */
export function redirectFromQuery(query: Record<string, unknown>): string | undefined {
  for (const name of REDIRECT_QUERY_NAMES) {
    const value = query[name]
    if (typeof value === 'string' && value !== '') {
      const safe = safeRedirectPath(value, '')
      if (safe !== '') {
        return safe
      }
    }
  }
  return undefined
}

export type RedirectTarget = { kind: 'route'; to: string } | { kind: 'external'; href: string }

/** `/admin/` or `/admin` → `/admin`; the root stays empty. */
function trimBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '')
}

/**
 * A safe path as the router wants it. `/admin/foo?x=1` is the route `/foo?x=1`, `/admin` is `/`; `/` or `/blog` is outside the
 * admin, so it is a full page load to the site.
 */
export function redirectTarget(path: string | undefined, baseURL: string): RedirectTarget {
  const safe = safeRedirectPath(path, DEFAULT_REDIRECT)
  const base = trimBase(baseURL)
  if (base === '') {
    return { kind: 'route', to: safe }
  }
  if (safe === base) {
    return { kind: 'route', to: '/' }
  }
  if (safe.startsWith(`${base}/`)) {
    return { kind: 'route', to: safe.slice(base.length) }
  }
  if (safe.startsWith(`${base}?`) || safe.startsWith(`${base}#`)) {
    return { kind: 'route', to: `/${safe.slice(base.length)}` }
  }
  return { kind: 'external', href: safe }
}

/**
 * The login address that brings a person back to `fullPath` (a router path with its query, e.g. `/foo?x=1`) after signing in.
 * The path is given with the base, as the API and `safeRedirectPath` see it. The sign-in screens themselves are not a
 * target worth coming back to, so they get none.
 */
export function loginLocation(fullPath: string, baseURL: string): { path: '/login'; query?: { redirectTo: string } } {
  const path = fullPath.split(/[?#]/, 1)[0] ?? ''
  if (path === '/login' || path === '/register' || path === '/logout') {
    return { path: '/login' }
  }
  if (path === '/' || path === '') {
    return { path: '/login' } // the start page is where a login goes anyway
  }
  const withBase = `${trimBase(baseURL)}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`
  const safe = safeRedirectPath(withBase, '')
  return safe === '' || safe === DEFAULT_REDIRECT ? { path: '/login' } : { path: '/login', query: { redirectTo: safe } }
}
