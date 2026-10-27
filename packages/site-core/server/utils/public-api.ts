// How the site's server reaches the public api (M1.4). The site's pages ask their own server (`/_toascribe/data/*`), and the server
// asks the api: one place for the cache by tag (M1.4 B3) and for what is sent along. Only the post password cookie goes to the api,
// as only it changes an answer there; the session cookie never leaves the site for these reads.
import type { H3Event } from 'h3'

import { POST_PASSWORD_COOKIE_NAME } from '@toascribe/shared'

/**
 * The api's address for the server: the internal one (`NUXT_API_URL_INTERNAL`, set by compose and by `nuxt dev`). Never built from
 * the request: its Host header is the visitor's to choose, and an answer fetched from another host would be cached for everyone.
 * Without it the site answers 502, as the API plugin's calls fail (nuxt-base app/plugins/api.ts).
 */
export function publicApiBase(): string {
  const config = useRuntimeConfig()
  const internal = config.apiUrlInternal.replace(/\/+$/, '')
  if (internal === '') throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  return `${internal}${config.public.apiBase}/v1/public`
}

/** The visitor's post password cookie, if any. */
export function postPassCookie(event: H3Event): string | undefined {
  const value = getCookie(event, POST_PASSWORD_COOKIE_NAME)
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
}

/** A GET of the public api, with the post password cookie when given. The api's 404 stays a 404; any other failure is a 502. */
export async function getPublicApi(path: string, postPass?: string): Promise<unknown> {
  const base = publicApiBase()
  try {
    return await $fetch(`${base}${path}`, {
      headers: postPass === undefined ? {} : { cookie: `${POST_PASSWORD_COOKIE_NAME}=${postPass}` },
      timeout: 5000,
      retry: 0,
    })
  } catch (error) {
    const status = typeof error === 'object' && error !== null ? Reflect.get(error, 'statusCode') : undefined
    throw createError({
      statusCode: status === 404 ? 404 : 502,
      statusMessage: status === 404 ? 'Not Found' : 'Bad Gateway',
    })
  }
}

/** A GET of the public api for this request: with the visitor's post password cookie when they have one. */
export function fromPublicApi(event: H3Event, path: string): Promise<unknown> {
  return getPublicApi(path, postPassCookie(event))
}

/** What the site's data routes answer with: private (an unlocked item is the visitor's own), and not kept by the browser. */
export function privateAnswer(event: H3Event): void {
  setResponseHeader(event, 'cache-control', 'private, no-store')
}
