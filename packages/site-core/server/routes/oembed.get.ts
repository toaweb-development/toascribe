import { PublicOEmbedQuery, PublicOEmbedResponse } from '@toascribe/shared'

/**
 * The site as an oEmbed provider (M1.6, K-225; WordPress' /wp-json/oembed/1.0/embed): `/oembed?url=` answers for this site's own
 * published, public content, through the cache by tag. Another address is 404, `format=xml` 501. The cache's tags stay here.
 */
export default defineEventHandler(async (event) => {
  if (await inMaintenance(event)) return { error: 'maintenance' }
  const query = PublicOEmbedQuery.safeParse(getQuery(event))
  if (!query.success) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  if (query.data.format === 'xml') throw createError({ statusCode: 501, statusMessage: 'Not Implemented' })
  const params = new URLSearchParams({ url: query.data.url })
  const { cacheTags: _tags, ...answer } = PublicOEmbedResponse.parse(
    await cachedFromPublicApi(event, `/oembed?${params.toString()}`),
  )
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache')
  return answer
})
