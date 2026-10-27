import { PublicGlobalSetResponse } from '@toascribe/shared'

/**
 * A global set (useGlobalSet, the «Globalt sett» block), through the cache by tag. A slug with no set is `found: false` from the api
 * (cached until a set is made), not a 404 a browser would log as an error.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  privateAnswer(event)
  return PublicGlobalSetResponse.parse(await cachedFromPublicApi(event, `/global-sets/${slug}`))
})
