import { PublicGlobalSetResponse } from '@toascribe/shared'

/**
 * A global set (useGlobalSet, the «Globalt sett» block), through the cache by tag. A slug with no set answers `null`, not 404: a theme
 * asks for its expected sets before they are made, and a browser would log the 404 as an error.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  privateAnswer(event)
  try {
    return PublicGlobalSetResponse.parse(await cachedFromPublicApi(event, `/global-sets/${slug}`))
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 404) return null
    throw error
  }
})
