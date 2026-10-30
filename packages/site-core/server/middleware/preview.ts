// A preview link (M2.1, K-071): `/?preview=<token>` is a bearer link to a draft. On the first visit the token goes into a short,
// HttpOnly cookie and the browser is sent on to `/?preview`, so the token is in no address the browser keeps in its history, shows,
// or sends on as a referrer; and the proxy's log, which would hold a query string, sees it once. The preview pages and this redirect
// send `Referrer-Policy: no-referrer`. A token that is not one (by its shape) clears the cookie: the page is then the site's 404.
import { PREVIEW_COOKIE_NAME, PREVIEW_LINK_MINUTES, PREVIEW_TOKEN_PATTERN } from '@toascribe/shared'

/** Seconds the token has left, from its payload (`{ e }`, seconds since 1970); undefined when it cannot be read. */
function secondsLeft(token: string, now: number): number | undefined {
  const payload = token.split('.')[1] ?? ''
  try {
    const expires: unknown = Reflect.get(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as object, 'e')
    return typeof expires === 'number' ? Math.floor(expires - now / 1000) : undefined
  } catch {
    return undefined
  }
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const url = getRequestURL(event)
  if (url.pathname !== '/' || !url.searchParams.has('preview')) return
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  const token = url.searchParams.get('preview') ?? ''
  // `/?preview`: the page with the token from the cookie, drawn by the app.
  if (token === '') return

  const left = PREVIEW_TOKEN_PATTERN.test(token) ? secondsLeft(token, Date.now()) : undefined
  if (left === undefined || left <= 0) {
    deleteCookie(event, PREVIEW_COOKIE_NAME, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' })
  } else {
    setCookie(event, PREVIEW_COOKIE_NAME, token, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: Math.min(left, PREVIEW_LINK_MINUTES * 60),
    })
  }
  setResponseHeader(event, 'cache-control', 'no-store')
  const page = url.searchParams.get('page')
  const onward = page !== null && /^[1-9]\d{0,4}$/.test(page) && page !== '1' ? `/?preview&page=${page}` : '/?preview'
  return sendRedirect(event, onward, 303)
})
