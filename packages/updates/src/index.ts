// @toascribe/updates (M1.7, K-290): is there a newer release? The image tags on ghcr.io behind a small source interface, the newest
// plain X.Y.Z among them, and the result in the `update_status` setting. Node only; the worker (daily) and the CLI use it.
import { safeFetch } from '@toascribe/http'

import { ghcrSource } from './ghcr.ts'
import type { UpdateSource } from './source.ts'

export { GHCR_ORIGIN, GHCR_REPOSITORY, UpdateSourceError, ghcrSource } from './ghcr.ts'
export { USER_AGENT } from './source.ts'
export type { Fetcher, UpdateSource } from './source.ts'
export { compareReleases, isNewer, newestRelease, parseRelease } from './version.ts'
export { checkForUpdate, runUpdateCheck, serverAllowsUpdateCheck, updateCheckSetting } from './check.ts'
export type { UpdateCheckResult } from './check.ts'

/** The source the app uses: ghcr.io through safeFetch (public addresses only, no redirect, a deadline, a cap on the body). */
export function defaultUpdateSource(): UpdateSource {
  return ghcrSource({
    fetch: (url, options) =>
      safeFetch(url, { headers: options.headers, maxRedirects: 0, timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 }),
  })
}
