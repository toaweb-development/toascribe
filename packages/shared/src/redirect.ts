// `redirect_to` after login (K-008, security §4 «Videresendinger»): the browser may be sent only to a path on this site.
// One validator for the api and the admin app. It accepts a path that starts with a single `/` and rejects everything
// else, rather than trying to clean it: a redirect target someone had to repair was not meant to be followed.

/** Where to go when `redirect_to` is missing or refused: the admin start page. */
export const DEFAULT_REDIRECT = '/admin'

const MAX_REDIRECT_LENGTH = 2048

/** C0 controls (tab, CR and LF included: a browser strips them from a URL, so `/\t/evil.com` becomes `//evil.com`), DEL, C1. */
const CONTROL_CHARACTERS = /\p{Cc}/u

/** Decoding rounds. Each round undoes one level of percent-encoding (`%252F` -> `%2F` -> `/`). */
const MAX_DECODE_ROUNDS = 4

function isSafeShape(candidate: string): boolean {
  if (CONTROL_CHARACTERS.test(candidate) || candidate.includes('\\')) {
    return false
  }
  // `/` alone or `/x`, never `//x` (protocol-relative, another host) and never `/\x` (browsers read `\` as `/`).
  return candidate.startsWith('/') && !candidate.startsWith('//')
}

/** True when `candidate` is a same-origin path: starts with one `/`, no backslash, no control character, no encoded trick. */
export function isSafeRedirectPath(candidate: string): boolean {
  if (candidate.length > MAX_REDIRECT_LENGTH || !isSafeShape(candidate)) {
    return false
  }
  // Look through the percent-encoding too. A server, a proxy or the page that reads `redirect_to` may decode it, and
  // `/%2F/evil.com`, `/%5Cevil.com` and `/%252F/evil.com` would then turn into `///evil.com`, `/\evil.com` and the like.
  let decoded = candidate
  let settled = false
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      if (round === 0) {
        return false // a malformed escape such as `%zz` or `%E0%A4`
      }
      settled = true // a literal `%` that an earlier round produced (`%25` -> `%`): nothing left to decode
      break
    }
    if (next === decoded) {
      settled = true
      break
    }
    if (!isSafeShape(next)) {
      return false
    }
    decoded = next
  }
  if (!settled) {
    return false // still changing after the last round: more layers of encoding than any real link has
  }
  // Last line of defence: the standard URL parser, which is what the browser does, must keep it on the same origin.
  try {
    const base = 'https://toascribe.invalid'
    return new URL(candidate, base).origin === base
  } catch {
    return false
  }
}

/** `redirect_to` if it is a safe same-origin path, otherwise `fallback`. Accepts any input, as it comes from a query string. */
export function safeRedirectPath(input: unknown, fallback: string = DEFAULT_REDIRECT): string {
  return typeof input === 'string' && isSafeRedirectPath(input) ? input : fallback
}
