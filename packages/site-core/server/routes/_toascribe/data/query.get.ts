import { PublicListResponse, PublicQuery } from '@toascribe/shared'

/** Published posts or pages by filter (useQuery, the Query Loop). */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (input) => PublicQuery.parse(input))
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  privateAnswer(event)
  const target = `/query?${params.toString()}`
  return PublicListResponse.parse(await cachedFromPublicApi(event, target))
})
