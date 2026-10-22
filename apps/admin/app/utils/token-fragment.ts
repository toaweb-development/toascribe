import { OneTimeToken } from '@toascribe/shared'

// The one-time links in the mail end in `#token=<43 characters>` (`/admin/login?action=resetpass#token=...`). A fragment is
// never sent to a server, so the token stays out of the proxy's access log and the `Referer` of the next page. The screen
// reads it, takes it out of the address bar and sends it in the body of the API call.

/** The token in a fragment (`#token=...`), or `undefined` when there is none or it cannot be a token. */
export function tokenFromHash(hash: string): string | undefined {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  const parsed = OneTimeToken.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/** The same address without the fragment, for `history.replaceState`. */
export function withoutFragment(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search}`
}

/** The part of `window` that is used, so a test needs no browser. */
interface FragmentWindow {
  location: { hash: string; pathname: string; search: string }
  history: { state: unknown; replaceState(data: unknown, unused: string, url: string): void }
}

/**
 * Reads the token from the address bar and removes the fragment right away (no history entry is added: the current one is
 * replaced). The fragment is removed even if it holds no usable token, so a pasted half link does not stay.
 */
export function takeTokenFromAddress(win: FragmentWindow): string | undefined {
  const { hash } = win.location
  if (hash === '') {
    return undefined
  }
  const token = tokenFromHash(hash)
  win.history.replaceState(win.history.state, '', withoutFragment(win.location))
  return token
}

/** `#token=...` for a token kept across a sign-in (the confirm-e-mail link needs a session first). */
export function hashForToken(token: string): string {
  return `#${new URLSearchParams({ token }).toString()}`
}
