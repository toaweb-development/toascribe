import { PublicPasswordRequest } from '@toascribe/shared'

import { isLocalPath } from '../../../app/lib/scribe'

// The password form without script (K-067): a plain form POST here, passed on to the api as JSON, and the visitor sent back to the
// item with 303. The api sets the cookie (its Set-Cookie is passed on) and limits the guesses; the visitor's address goes along in
// X-Real-IP, and the browser's Origin, which the api checks (a form from another site is refused there). A wrong password or a wait
// comes back as `?postpass=wrong` / `?postpass=wait` on the item's address, which the form shows.
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event).catch(() => undefined)
  const field = (name: string): string => {
    const value = typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined
    return typeof value === 'string' ? value : ''
  }
  const back = field('return')
  const target = isLocalPath(back) && back.length <= 2000 ? back : '/'
  const parsed = PublicPasswordRequest.safeParse({ contentId: field('contentId'), password: field('password') })
  const again = (state: 'wrong' | 'wait') => {
    const url = new URL(target, 'http://site.invalid')
    url.searchParams.set('postpass', state)
    return sendRedirect(event, `${url.pathname}${url.search}`, 303)
  }
  if (!parsed.success) return again('wrong')

  const origin = getRequestHeader(event, 'origin')
  const ip = getRequestHeader(event, 'x-real-ip')
  const answer = await $fetch
    .raw(`${publicApiBase()}/unlock`, {
      method: 'POST',
      body: parsed.data,
      headers: {
        ...(origin === undefined ? {} : { origin }),
        ...(ip === undefined ? {} : { 'x-real-ip': ip }),
      },
      timeout: 5000,
      retry: 0,
      ignoreResponseError: true,
    })
    .catch(() => undefined)
  if (answer === undefined) throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  if (answer.status === 429) return again('wait')
  if (answer.status !== 204) return again('wrong')
  for (const cookie of answer.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
  setResponseHeader(event, 'cache-control', 'no-store')
  return sendRedirect(event, target, 303)
})
