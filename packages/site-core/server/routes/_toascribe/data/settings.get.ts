import { PublicSettings } from '@toascribe/shared'

/** The settings a theme shows. */
export default defineEventHandler(async (event) => {
  privateAnswer(event)
  return PublicSettings.parse(await cachedFromPublicApi(event, '/settings'))
})
