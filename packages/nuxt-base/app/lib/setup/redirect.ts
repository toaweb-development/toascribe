import { SetupToken } from '@toascribe/shared'

// Where a page goes while the site is not installed (M0.4). Pure functions: the middleware that uses them is
// app/middleware/setup-redirect.global.ts, and a test exercises them without a Nuxt runtime.

/** The wizard's address in the admin app's own router (the admin is built with the base path `/admin`). */
export const SETUP_ROUTE = '/setup'

/** The wizard's address as a browser sees it, for the site, which is another app and so another base path. */
export const ADMIN_SETUP_ADDRESS = '/admin/setup'

export type SetupRedirect =
  /** Show the page. */
  | { kind: 'none' }
  /** A route of this app (the admin sending a page to its own wizard). */
  | { kind: 'route'; to: { path: string; query: Record<string, string> } }
  /** A full page load (the site sending a visitor to the admin). */
  | { kind: 'external'; href: string }
  /** The wizard after the install: it does not exist any more. */
  | { kind: 'not-found' }

export interface SetupRedirectInput {
  installed: boolean
  /** True in the app that has the wizard page (the admin). */
  hostsWizard: boolean
  /** The path of the page asked for, without the base path and without the query. */
  path: string
  /** The query of the page asked for. Only `token` is looked at. */
  query: Record<string, unknown>
}

/** `/setup/` and `/setup` are the same page. */
function normalised(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * The setup token in the query, if it looks like one. It is carried on to the wizard so that a link such as
 * `/admin/login?token=...` or `/?token=...` still gets there with the token; anything else in the query is dropped, and a value
 * that cannot be a token is not passed on (a redirect is not a place to reflect arbitrary text).
 */
export function tokenFromQuery(query: Record<string, unknown>): string | undefined {
  const value = Array.isArray(query.token) ? query.token[0] : query.token
  const parsed = SetupToken.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * - Not installed: every page goes to the wizard (and keeps `?token=`); the wizard itself is shown.
 * - Installed: no page goes anywhere, and the wizard is a 404.
 */
export function decideSetupRedirect(input: SetupRedirectInput): SetupRedirect {
  const onWizard = input.hostsWizard && normalised(input.path) === SETUP_ROUTE
  if (input.installed) {
    return onWizard ? { kind: 'not-found' } : { kind: 'none' }
  }
  if (onWizard) {
    return { kind: 'none' }
  }
  const token = tokenFromQuery(input.query)
  if (input.hostsWizard) {
    return { kind: 'route', to: { path: SETUP_ROUTE, query: token === undefined ? {} : { token } } }
  }
  return {
    kind: 'external',
    href:
      token === undefined ? ADMIN_SETUP_ADDRESS : `${ADMIN_SETUP_ADDRESS}?${new URLSearchParams({ token }).toString()}`,
  }
}
