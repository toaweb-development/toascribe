// The tags of the public image ghcr.io/toaweb-development/toascribe-api, read as the OCI distribution API gives them to anyone: an
// anonymous pull token, then /v2/<name>/tags/list, page by page by its `Link: <...>; rel="next"`. Nothing about the site goes out:
// two GETs with `User-Agent: toascribe` (and the anonymous token, which GHCR asks for even for a public image).
import { z } from 'zod'

import { USER_AGENT } from './source.ts'
import type { Fetcher, UpdateSource } from './source.ts'

export const GHCR_ORIGIN = 'https://ghcr.io'
export const GHCR_REPOSITORY = 'toaweb-development/toascribe-api'
/** At most this many pages of 1000 tags: enough for years of releases, and a stop for a source that never ends. */
const MAX_PAGES = 20

/** Only characters a header value may hold: a token that would break the header is refused, never quoted into an error. */
const TokenAnswer = z.object({ token: z.string().regex(/^[A-Za-z0-9._~+/=-]{1,10000}$/) })
const TagsAnswer = z.object({ tags: z.array(z.string().max(200)).max(10_000).nullable() })

export class UpdateSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpdateSourceError'
  }
}

function json(body: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    throw new UpdateSourceError('the registry did not answer with JSON')
  }
}

/** The next page's address from `Link`, only when it is the same tag list on the same host (never a jump elsewhere). */
function nextPage(link: string | null, repository: string): string | undefined {
  const target = link === null ? undefined : /<([^>]+)>\s*;\s*rel="?next"?/.exec(link)?.[1]
  if (target === undefined) return undefined
  const url = new URL(target, GHCR_ORIGIN)
  if (url.origin !== GHCR_ORIGIN || url.pathname !== `/v2/${repository}/tags/list`) {
    throw new UpdateSourceError('the registry sent a next page elsewhere')
  }
  return url.href
}

export function ghcrSource(options: { readonly fetch: Fetcher; readonly repository?: string }): UpdateSource {
  const repository = options.repository ?? GHCR_REPOSITORY
  return {
    async tags() {
      const tokenUrl = new URL('/token', GHCR_ORIGIN)
      tokenUrl.searchParams.set('scope', `repository:${repository}:pull`)
      const tokenAnswer = await options.fetch(tokenUrl.href, { headers: { 'User-Agent': USER_AGENT } })
      if (tokenAnswer.status !== 200) {
        throw new UpdateSourceError(`the registry refused a token (${String(tokenAnswer.status)})`)
      }
      const token = TokenAnswer.safeParse(json(tokenAnswer.body))
      if (!token.success) throw new UpdateSourceError('the registry sent no token')

      const tags: string[] = []
      let page: string | undefined = `${GHCR_ORIGIN}/v2/${repository}/tags/list?n=1000`
      for (let count = 0; page !== undefined; count += 1) {
        if (count === MAX_PAGES) throw new UpdateSourceError('the registry sent too many pages')
        const answer = await options.fetch(page, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Authorization: `Bearer ${token.data.token}`,
          },
        })
        if (answer.status !== 200) throw new UpdateSourceError(`the registry answered ${String(answer.status)}`)
        const parsed = TagsAnswer.safeParse(json(answer.body))
        if (!parsed.success) throw new UpdateSourceError('the registry sent no tag list')
        tags.push(...(parsed.data.tags ?? []))
        page = nextPage(answer.headers.get('link'), repository)
      }
      return tags
    },
  }
}
