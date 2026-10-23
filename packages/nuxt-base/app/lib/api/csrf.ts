// The CSRF token of the signed-in session (K-258). The API hands it out in the body of `GET /auth/session`, of the login
// answer and of the second-factor answer, and wants it back in `X-CSRF-Token` on every state-changing call that has a session.
//
// It is held in memory only: a closure per browser tab, and per request on the server. It is never written to a cookie,
// to localStorage or to the Nuxt payload (the HTML), so a script that is not this code has nothing to read.

export interface CsrfStore {
  get(): string | undefined
  set(token: string | undefined): void
}

export function createCsrfStore(): CsrfStore {
  let token: string | undefined
  return {
    get: () => token,
    set: (next) => {
      token = next === undefined || next === '' ? undefined : next
    },
  }
}

export const CSRF_HEADER = 'X-CSRF-Token'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** True for POST, PATCH, PUT and DELETE. */
export function isStateChanging(method: string | undefined): boolean {
  return !SAFE_METHODS.has((method ?? 'GET').toUpperCase())
}

/** The path of a request: no query, no fragment. A Request object or URL is not used by the API layer. */
export function pathOf(request: unknown): string {
  const text = typeof request === 'string' ? request : ''
  return text.split(/[?#]/, 1)[0] ?? ''
}

/**
 * The calls that have no session to protect: they answer without one, so no token is needed. (The login call is one of
 * them: it makes the session.) Everything else that changes state sends the token, or fetches one first.
 */
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/password/lost',
  '/auth/password/reset',
  '/auth/password/set',
]

/**
 * The setup wizard's calls (`/v1/setup/*`) are public too, in a different way: before the site is installed there is no
 * session, and the one-time setup token in `X-Setup-Token` (a header a cross-site form cannot send) takes the place of the
 * CSRF token. Asking for a session first would only be a call that answers `anonymous`.
 */
const PUBLIC_PREFIXES = ['/v1/setup/']

export function isPublicPath(path: string): boolean {
  return (
    PUBLIC_PATHS.some((entry) => path === entry || path.endsWith(entry)) ||
    PUBLIC_PREFIXES.some((prefix) => path.includes(prefix))
  )
}

/** The calls whose answer carries `csrfToken` (and so replaces the one held). */
const TOKEN_PATHS = ['/auth/session', '/auth/login', '/auth/mfa/verify']

/**
 * What to hold after an answer from `path`: the token in the body, `null` when the body says nobody is signed in (the old
 * token is dead), or `undefined` when this answer says nothing about it.
 */
export function tokenFromAnswer(path: string, body: unknown): string | null | undefined {
  if (!TOKEN_PATHS.some((entry) => path.endsWith(entry))) {
    return undefined
  }
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const record = body as Record<string, unknown>
  if (record.status === 'anonymous') {
    return null
  }
  return typeof record.csrfToken === 'string' && record.csrfToken !== '' ? record.csrfToken : undefined
}
