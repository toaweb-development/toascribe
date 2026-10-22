// @toascribe/http: the one way to fetch an address a user gave (webhooks, import from a URL, link previews). Node only.
import { createSafeFetch } from './safe-fetch.ts'

export { isPublicAddress } from './address.ts'
export { SAFE_FETCH_ERROR_CODES, SafeFetchError } from './safe-fetch.ts'
export type { SafeFetchErrorCode, SafeFetchOptions, SafeResponse } from './safe-fetch.ts'

/**
 * Fetches `url` the way SECURITY §4 «SSRF» asks: only http and https on the allowed ports, only to public addresses
 * (checked on the name's addresses and on IP literals, on every redirect too), at most three redirects, a deadline and a
 * cap on the body. Throws `SafeFetchError` with a `code`; the message never holds an address or a response.
 */
export const safeFetch = createSafeFetch()
