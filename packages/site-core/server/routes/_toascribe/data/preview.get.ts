import { PreviewQuery, ResolveResponse } from '@toascribe/shared'

/** The item a preview link shows (K-071). Never cached: it is for whoever holds the link, while it works. */
export default defineEventHandler(async (event) => {
  const { token, page } = await getValidatedQuery(event, (query) => PreviewQuery.parse(query))
  privateAnswer(event)
  const params = new URLSearchParams({ token, page: String(page) })
  return ResolveResponse.parse(await fromPublicApi(event, `/preview?${params.toString()}`))
})
