// The site's active theme, as the api needs it for the admin's checks (M1.5 leftovers): which menu locations exist, and which theme
// «Tilpass» stores choices for. The site's build chooses the theme (toascribe.toml), so the site is where the answer is: its
// `/_toascribe/theme`, read over the internal network (SITE_URL_INTERNAL) and kept for a short while. Only admin actions ask; a
// visitor's request never waits on it. When the site cannot be asked, the action is refused with 503 rather than saved unchecked.
import { ActiveTheme } from '@toascribe/shared'

import { AppError } from '../lib/errors.ts'

/** How long an answer is kept. A new theme comes with a new site build, so a minute is plenty. */
const KEEP_MS = 60_000
const TIMEOUT_MS = 3_000

export interface ActiveThemeSource {
  /** The active theme, or null when the site was built without one. Throws a 503 when the site does not answer. */
  current(): Promise<ActiveTheme | null>
}

export class SiteUnavailableError extends AppError {
  constructor() {
    super(503, 'site_unavailable', 'The site did not say which theme is active; try again in a moment')
  }
}

/** Reads `/_toascribe/theme` from the site at `siteUrl` (an internal address from the config, never from a request). */
export function siteThemeSource(options: {
  readonly siteUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
}): ActiveThemeSource {
  const fetchFn = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const url = new URL('/_toascribe/theme', options.siteUrl)
  let kept: { theme: ActiveTheme | null; until: number } | undefined
  return {
    async current() {
      if (kept !== undefined && kept.until > now()) return kept.theme
      let theme: ActiveTheme | null
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
        if (res.status === 404) theme = null
        else if (res.ok) theme = ActiveTheme.parse(await res.json())
        else throw new Error(`status ${String(res.status)}`)
      } catch {
        throw new SiteUnavailableError()
      }
      kept = { theme, until: now() + KEEP_MS }
      return theme
    },
  }
}

/** A fixed answer (tests, and a stack whose site is known). */
export function fixedThemeSource(theme: ActiveTheme | null): ActiveThemeSource {
  return { current: async () => theme }
}
