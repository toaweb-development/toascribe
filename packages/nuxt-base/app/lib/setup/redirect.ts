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
  | { kind: 'route'; to: { path: string } }
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
}

/** `/setup/` and `/setup` are the same page. */
function normalised(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * - Not installed: every page goes to the wizard; the wizard itself is shown. A setup code in the fragment of the address
 *   (`#token=`) is not here: a server never sees a fragment and `Location` carries none, so the browser keeps it on the way.
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
  return input.hostsWizard
    ? { kind: 'route', to: { path: SETUP_ROUTE } }
    : { kind: 'external', href: ADMIN_SETUP_ADDRESS }
}
