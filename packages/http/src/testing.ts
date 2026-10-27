// @toascribe/http/testing: a client with a name lookup and an address rule of the test's own, so a test can reach a server on this
// machine through the real redirect and address checks (an oEmbed provider that redirects to a private address, say). Tests only:
// with `isAllowed` it can reach any address, which is why it is not in the package's main entry; `safeFetch` is what the app uses,
// and a test (test/http-entry.test.ts at the root) checks that no app code imports this file.
export { createSafeFetch } from './safe-fetch.ts'
export type { ResolvedAddress, SafeFetchInternals } from './safe-fetch.ts'
