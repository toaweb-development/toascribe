// Where releases are looked up (M1.7, K-290). One implementation now (the image tags on ghcr.io); a mirror or a feed of its own would
// be another, behind the same interface.
import type { SafeResponse } from '@toascribe/http'

export interface UpdateSource {
  /** Every tag the source has (a release or not); throws on a failure. */
  tags(): Promise<readonly string[]>
}

/** The part of safeFetch a source uses: a GET with headers. A test passes a stored answer. */
export type Fetcher = (
  url: string,
  options: { readonly headers: Readonly<Record<string, string>> },
) => Promise<Pick<SafeResponse, 'status' | 'headers' | 'body'>>

/** The one header every request carries: who asks, and nothing about the site (no version, no address, no id). */
export const USER_AGENT = 'toascribe'
