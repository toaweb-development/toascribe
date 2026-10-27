import { POST_PASSWORD_COOKIE_NAME, PublicPasswordRequest } from '@toascribe/shared'

import { isLocalPath } from '../../../app/lib/scribe'

// The password form without script (K-067): a plain form POST here, passed on to the api as JSON, and the visitor sent back to the
// item with 303. The api sets the cookie (its post password cookie is passed on, nothing else) and limits the guesses; the visitor's
// address goes along in X-Real-IP, and the browser's Origin and Sec-Fetch-Site, which the api checks before it counts a guess (a form
// from another site is refused there). A wrong password or a wait comes back as `?postpass=wrong` / `?postpass=wait` on the item's
// address, which the form shows.

/** The most a password form may send: two short fields and a path. Caddy caps it too (docker/proxy/Caddyfile). */
const MAX_BODY_BYTES = 8 * 1024

/** A path on the site to send the visitor back to, rebuilt from its parts so nothing but a path and a query can come out of it. */
function localTarget(back: string, postpass?: 'wrong' | 'wait'): string {
  const url = new URL(isLocalPath(back) && back.length <= 2000 ? back : '/', 'http://site.invalid')
  if (url.origin !== 'http://site.invalid') return '/'
  if (postpass !== undefined) url.searchParams.set('postpass', postpass)
  return `${url.pathname}${url.search}`
}

export default defineEventHandler(async (event) => {
  const length = Number(getRequestHeader(event, 'content-length') ?? 'NaN')
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }
  const body: unknown = await readBody(event).catch(() => undefined)
  const field = (name: string): string => {
    const value = typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined
    return typeof value === 'string' ? value : ''
  }
  const back = field('return')
  const again = (state: 'wrong' | 'wait') => sendRedirect(event, localTarget(back, state), 303)
  const parsed = PublicPasswordRequest.safeParse({ contentId: field('contentId'), password: field('password') })
  if (!parsed.success) return again('wrong')

  const passed: Record<string, string> = {}
  for (const name of ['origin', 'sec-fetch-site', 'x-real-ip']) {
    const value = getRequestHeader(event, name)
    if (value !== undefined) passed[name] = value
  }
  const answer = await $fetch
    .raw(`${publicApiBase()}/unlock`, {
      method: 'POST',
      body: parsed.data,
      headers: passed,
      timeout: 5000,
      retry: 0,
      ignoreResponseError: true,
    })
    .catch(() => undefined)
  if (answer === undefined || answer.status >= 500) throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  if (answer.status === 429) return again('wait')
  // A wrong password, or a request the api refused (from another site): the form says the same.
  if (answer.status !== 204) return again('wrong')
  for (const cookie of answer.headers.getSetCookie()) {
    if (cookie.startsWith(`${POST_PASSWORD_COOKIE_NAME}=`)) appendResponseHeader(event, 'set-cookie', cookie)
  }
  setResponseHeader(event, 'cache-control', 'no-store')
  return sendRedirect(event, localTarget(back), 303)
})
