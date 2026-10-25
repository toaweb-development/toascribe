import { SetupToken } from '@toascribe/shared'

// The one-time setup token in the browser (M0.4). The api writes it to its log as an address with the token in the fragment,
// `/admin/setup#token=...`, and a person who opens that address lands in the wizard. The token is a secret until the install,
// so it must not stay where the address bar, the history and a screenshot keep it, and it must not reach a server or a log:
// - it is in the fragment because a browser never sends the fragment: not to the proxy, not to the admin app, not in a
//   `Referer`. So the page the server draws cannot contain it, and no access log can. The browser keeps the fragment across a
//   redirect whose `Location` has none (the proxy's 308 and the app's 302 from `/` or `/admin/login` to the wizard);
// - it is read once, in the browser, from the fragment (`takeTokenFromHash`), and the address is replaced with one without it
//   (the wizard does this with the router, so no history entry is added);
// - it is kept for this tab only, in `sessionStorage`, so a reload does not ask for it again. It is not in a cookie, not in
//   `localStorage` (other tabs, later visits) and not in the server-drawn page. The install deletes the token on the server,
//   and the wizard clears it here;
// - it goes to the api in the `X-Setup-Token` header only. A token in the query (`?token=`) is not read: the paste form is the
//   other way in. A rejected `?token=` is taken out of the address bar too (`withoutTokenQuery`), without its value being read.

export const SETUP_TOKEN_STORAGE_KEY = 'toascribe:setup-token'

/** The part of `Storage` that is used, so a test needs no browser. */
export interface TokenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * The browser's session storage, or `undefined` where there is none or it refuses (a private window, blocked site data): the
 * wizard then keeps the token in memory only, and a reload asks for it again.
 */
export function tabStorage(): TokenStorage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/** The token kept for this tab, if there is one that can be a token. */
export function readStoredToken(storage: TokenStorage | undefined = tabStorage()): string | undefined {
  try {
    const parsed = SetupToken.safeParse(storage?.getItem(SETUP_TOKEN_STORAGE_KEY))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function storeToken(token: string, storage: TokenStorage | undefined = tabStorage()): void {
  try {
    storage?.setItem(SETUP_TOKEN_STORAGE_KEY, token)
  } catch {
    // Kept in memory only.
  }
}

export function clearStoredToken(storage: TokenStorage | undefined = tabStorage()): void {
  try {
    storage?.removeItem(SETUP_TOKEN_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** What the fragment of the address carried: the token, if it can be one, and whether there was a `token` at all. */
export interface TokenInHash {
  token: string | undefined
  present: boolean
  /** The fragment without `token`, in the form the router takes (`#a=1`, or `''` when nothing is left). */
  rest: string
}

/** Reads `#token=...` (a fragment of `key=value` pairs, as `URLSearchParams` reads it). It is removed from the address either way. */
export function takeTokenFromHash(hash: string): TokenInHash {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const present = params.has('token')
  if (!present) {
    return { token: undefined, present: false, rest: hash === '#' ? '' : hash }
  }
  const parsed = SetupToken.safeParse(params.get('token'))
  params.delete('token')
  const rest = params.toString()
  return { token: parsed.success ? parsed.data : undefined, present, rest: rest === '' ? '' : `#${rest}` }
}

/**
 * The query of the address without `token`. The value is never read, kept or passed on: it is dropped, whatever it is. Every other
 * parameter stays. `removed` says whether there was one, so the caller replaces the address only when something changes.
 */
export function withoutTokenQuery<T extends Record<string, unknown>>(
  query: T,
): { query: Omit<T, 'token'>; removed: boolean } {
  const { token: _dropped, ...rest } = query
  return { query: rest, removed: 'token' in query }
}
