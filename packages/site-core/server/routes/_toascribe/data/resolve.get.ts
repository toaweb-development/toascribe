import { ResolveQuery, ResolveResponse } from '@toascribe/shared'

/** What an address is (the catch-all route asks this, on the server and in the browser). */
export default defineEventHandler(async (event) => {
  const { path } = await getValidatedQuery(event, (query) => ResolveQuery.parse(query))
  privateAnswer(event)
  const target = `/resolve?${new URLSearchParams({ path }).toString()}`
  return ResolveResponse.parse(await cachedFromPublicApi(event, target))
})
