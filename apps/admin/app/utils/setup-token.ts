import { SetupToken } from '@toascribe/shared'

// The one-time setup token in the browser (M0.4). The api writes it to its log as an address, `/admin/setup?token=...`, and a
// person who opens that address lands in the wizard. The token is a secret until the install, so it must not stay where the
// address bar, the history and a screenshot keep it:
// - it is read once from the address and the address is replaced with one that has no token (the page does this with the
//   router; `withoutToken` makes the query);
// - it is kept for this tab only, in `sessionStorage`, so a reload does not ask for it again. It is not in a cookie, not in
//   `localStorage` (other tabs, later visits) and not in the page payload. The install deletes the token on the server, and the
//   wizard clears it here.
// - it goes to the api in the `X-Setup-Token` header only.

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

/** What the address carried: the token, if it can be one, and whether there was a `token` at all (it is removed either way). */
export interface TokenInQuery {
  token: string | undefined
  present: boolean
  /** The rest of the query, without `token`. */
  rest: Record<string, string | (string | null)[] | null | undefined>
}

export function takeTokenFromQuery(query: Record<string, string | (string | null)[] | null | undefined>): TokenInQuery {
  const { token: raw, ...rest } = query
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = SetupToken.safeParse(value)
  return { token: parsed.success ? parsed.data : undefined, present: 'token' in query, rest }
}
