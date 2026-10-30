import { PREVIEW_COOKIE_NAME, PREVIEW_TOKEN_PATTERN, ResolveResponse } from '@toascribe/shared'
import { z } from 'zod'

const Query = z.object({
  token: z.string().min(1).max(600).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

/**
 * The item a preview link shows (K-071). Never cached: it is for whoever holds the link, while it works. The token is in the cookie
 * the first visit set (M2.1, server/middleware/preview.ts); one in the query still works for a caller that has it.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => Query.parse(value))
  privateAnswer(event)
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  const token = query.token ?? getCookie(event, PREVIEW_COOKIE_NAME)
  if (token === undefined || !PREVIEW_TOKEN_PATTERN.test(token)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const params = new URLSearchParams({ token, page: String(query.page) })
  return ResolveResponse.parse(await fromPublicApi(event, `/preview?${params.toString()}`))
})
