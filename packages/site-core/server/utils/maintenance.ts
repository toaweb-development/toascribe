import { PublicSettings } from '@toascribe/shared'
import type { H3Event } from 'h3'

/**
 * Maintenance mode (M1.7, K-288) for the site's documents that are not pages (feeds, the sitemap, robots.txt, /oembed): true, with
 * 503 and Retry-After set, while it is on. Nobody signed in is asked about: these documents are for crawlers and readers.
 */
export async function inMaintenance(event: H3Event): Promise<boolean> {
  const settings = PublicSettings.parse(await cachedFromPublicApi(event, '/settings'))
  if (!settings.maintenance.enabled) return false
  setResponseStatus(event, 503)
  setResponseHeader(event, 'retry-after', settings.maintenance.retryAfter)
  return true
}
