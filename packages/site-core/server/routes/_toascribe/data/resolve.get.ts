import { ResolveQuery, ResolveResponse } from '@toascribe/shared'

/** What an address is (the catch-all route asks this, on the server and in the browser). */
export default defineEventHandler(async (event) => {
  const { path } = await getValidatedQuery(event, (query) => ResolveQuery.parse(query))
  privateAnswer(event)
  return ResolveResponse.parse(await fromPublicApi(event, `/resolve?${new URLSearchParams({ path }).toString()}`))
})
