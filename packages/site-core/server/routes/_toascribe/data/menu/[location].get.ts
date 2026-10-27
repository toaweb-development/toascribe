import { PublicMenuResponse } from '@toascribe/shared'

/** The menu in a theme location (useMenu): published content only, through the cache by tag. */
export default defineEventHandler(async (event) => {
  const location = getRouterParam(event, 'location') ?? ''
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(location)) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  privateAnswer(event)
  return PublicMenuResponse.parse(await cachedFromPublicApi(event, `/menus/${location}`))
})
