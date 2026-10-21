import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

/**
 * The session cookie's name without its prefix. The browser sees `__Host-toa_session`: the prefix makes it refuse the
 * cookie unless it is Secure, has Path=/ and no Domain, so a sibling domain or a plain-HTTP page cannot plant or replace it.
 */
export const SESSION_COOKIE = 'toa_session'

/**
 * Sets the session cookie: HttpOnly (script cannot read it), Secure and SameSite=Lax (security §3). With `maxAgeSeconds`
 * it survives the browser (Remember me); without, it goes when the browser closes. The server decides the real expiry.
 *
 * `Secure` is not conditional on the request: behind the TLS proxy the api sees HTTP, and the browser must still be told.
 */
export function setSessionCookie(c: Context, token: string, maxAgeSeconds?: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    prefix: 'host',
    httpOnly: true,
    sameSite: 'Lax',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', httpOnly: true, sameSite: 'Lax' })
}

/** The token in the request's session cookie, if any and if it looks like one. */
export function readSessionCookie(c: Context): string | undefined {
  const value = getCookie(c, SESSION_COOKIE, 'host')
  // A token is 43 base64url characters. Anything else cannot be one, so it is not worth a database lookup.
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
}
