import { PublicGlobalSetResponse } from '@toascribe/shared'

/** A global set (useGlobalSet, the «Globalt sett» block), through the cache by tag. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  privateAnswer(event)
  return PublicGlobalSetResponse.parse(await cachedFromPublicApi(event, `/global-sets/${slug}`))
})
