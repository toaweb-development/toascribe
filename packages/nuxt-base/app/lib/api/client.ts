import type { ApiRequestError } from './errors.ts'
import { toApiRequestError } from './errors.ts'
import { CSRF_HEADER, isPublicPath, isStateChanging, pathOf, tokenFromAnswer } from './csrf.ts'
import type { CsrfStore } from './csrf.ts'

/** What the API layer passes on to `$fetch`: a method and a JSON (or multipart) body. */
export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** JSON, or a FormData for a file upload (multipart; `$fetch` sets the content type and boundary). */
  body?: Record<string, unknown> | FormData
  /** Headers for this call only (the setup wizard's `X-Setup-Token`). */
  headers?: Record<string, string>
  /** Milliseconds to wait for this call, when the default is too short (the wizard's test e-mail waits for the worker). */
  timeout?: number
}

/** A call to the API: a path under the API base in, the parsed JSON (or undefined for 204) out. Throws ApiRequestError. */
export type ApiCall = (path: string, options?: ApiCallOptions) => Promise<unknown>

/** The calls that ask who is signed in or finish signing in: a 401 from them is an answer, not a lost session. */
const SESSION_PATHS = ['/auth/session', '/auth/login', '/auth/mfa/verify']

/** How long a call that changes something may take. Reading is quick (3 s); hashing a password and queueing mail are not. */
export const WRITE_TIMEOUT_MS = 15_000

/** The part of ofetch's `$fetch.create` that the client uses, so a test can hand in the real ofetch. */
export interface FetchContext {
  request: unknown
  options: { method?: string; headers: Headers; timeout?: number }
  response?: { _data?: unknown }
}

export interface FetchDefaults {
  baseURL: string
  timeout: number
  retry: false
  credentials: 'include'
  headers?: Record<string, string>
  onRequest(context: FetchContext): Promise<void>
  onResponse(context: FetchContext): void
}

export interface ApiClientDeps {
  /** `$fetch.create` of Nuxt (or `ofetch.create`). */
  create: (defaults: FetchDefaults) => ApiCall
  baseURL: string
  /** The cookie of the request being rendered, on the server; nothing in the browser. */
  headers?: Record<string, string>
  csrf: CsrfStore
  /** True in the browser. A token can only be fetched there: the server never changes anything. */
  isClient: boolean
  /** Told once for each 401 `unauthorized` / `mfa_required` from a call that is not a session probe. */
  onUnauthorized?: (error: ApiRequestError) => void
}

/**
 * The one `$fetch` for the API (nuxt-vue §6), with what every call needs:
 * - the session cookie goes along (`credentials: 'include'`), and on the server the cookie of the page request is forwarded;
 * - a call that changes state sends `X-CSRF-Token`; when the page has no token yet (a reload), `GET /auth/session` fetches it first;
 * - the CSRF token in a session, login or second-factor answer replaces the one held, and an `anonymous` answer drops it;
 * - every failure is an ApiRequestError, and a 401 that says the session is gone is reported to `onUnauthorized`.
 */
export function createApiClient(deps: ApiClientDeps): ApiCall {
  const { csrf } = deps

  const raw = deps.create({
    baseURL: deps.baseURL,
    // A hung API must not hang the page: give up after 3 s, and never retry (a retry of a write could do it twice).
    timeout: 3000,
    retry: false,
    credentials: 'include',
    headers: deps.headers,
    async onRequest({ request, options }) {
      if (!isStateChanging(options.method)) {
        return
      }
      options.timeout = Math.max(options.timeout ?? 0, WRITE_TIMEOUT_MS)
      const path = pathOf(request)
      if (path.endsWith('/auth/login')) {
        return // makes the session: there is nothing to protect yet
      }
      let token = csrf.get()
      if (token === undefined && deps.isClient && !isPublicPath(path)) {
        token = await fetchToken()
      }
      if (token !== undefined) {
        options.headers.set(CSRF_HEADER, token)
      }
    },
    onResponse({ request, response }) {
      const token = tokenFromAnswer(pathOf(request), response?._data)
      if (token !== undefined) {
        csrf.set(token === null ? undefined : token)
      }
    },
  })

  // Called from onRequest above, only once a write is under way, so `raw` exists by then.
  async function fetchToken(): Promise<string | undefined> {
    try {
      await raw('/v1/auth/session') // the answer hook stores the token
    } catch {
      // The write that follows fails with its own error (a 403 without a token); this one need not.
    }
    return csrf.get()
  }

  return async (path, options) => {
    try {
      return await raw(path, options)
    } catch (caught) {
      const error = toApiRequestError(caught)
      const sessionGone = error.status === 401 && (error.code === 'unauthorized' || error.code === 'mfa_required')
      if (sessionGone && !SESSION_PATHS.some((entry) => path.endsWith(entry))) {
        csrf.set(undefined)
        deps.onUnauthorized?.(error)
      }
      throw error
    }
  }
}
