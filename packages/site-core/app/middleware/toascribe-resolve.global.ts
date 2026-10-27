import type { PublicSettings, ResolveResponse, SiteCustomization } from '@toascribe/shared'

import { addressOf, isLocalPath } from '../lib/scribe'

// What the address is, asked before the page is drawn (M1.4): on the server for the first request, in the browser for the next.
// After `setup-redirect` (global middleware run in name order), so an uninstalled site still goes to the wizard first.
// - A redirect (`/?p=12`, an address without its closing slash, the front page's own slug) is a 301 to a path on the site.
// - 404 is an answer the theme draws (`templates/404.vue`), with the status 404.
// - The site's settings and «Tilpass» are read with the first address and kept for the page load.
// - A preview link (`?preview=`) shows its item; a link that is not good is a 404.
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.client && useNuxtApp().payload.error) return
  const fetcher = useRequestFetch()
  const event = useRequestEvent()
  const state = useScribeState()
  const settings = useSettings()
  const customize = useCustomizeState()

  const address = addressOf(to)
  const key = JSON.stringify(address)
  // The server resolved this address already: the browser takes its answer from the payload.
  if (state.value?.key === key) return

  const ask = async (): Promise<ResolveResponse> => {
    if (address.kind === 'resolve') {
      return fetcher<ResolveResponse>('/_toascribe/data/resolve', { query: { path: address.path } })
    }
    try {
      return await fetcher<ResolveResponse>('/_toascribe/data/preview', {
        query: { token: address.token, page: address.page },
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 404) {
        return { kind: '404', status: 404, templates: ['404', 'index'], cacheTags: [] }
      }
      throw error
    }
  }

  let resolved: ResolveResponse
  try {
    const [answer, read, look] = await Promise.all([
      ask(),
      settings.value === null ? fetcher<PublicSettings>('/_toascribe/data/settings') : Promise.resolve(settings.value),
      customize.value === null
        ? fetcher<SiteCustomization>('/_toascribe/data/customize')
        : Promise.resolve(customize.value),
    ])
    resolved = answer
    settings.value = read
    customize.value = look
  } catch (error) {
    // An address the api refuses to read (too long, say) is no page: the theme's 404. Anything else is the api being away.
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 400) {
      resolved = { kind: '404', status: 404, templates: ['404', 'index'], cacheTags: [] }
    } else {
      return abortNavigation(createError({ statusCode: 503, statusMessage: 'Service Unavailable', fatal: true }))
    }
  }

  if (resolved.kind === 'redirect') {
    if (!isLocalPath(resolved.location)) return abortNavigation(createError({ statusCode: 404, fatal: true }))
    return navigateTo(resolved.location, { redirectCode: 301 })
  }
  if (resolved.status === 404 && event !== undefined) setResponseStatus(event, 404)
  state.value = { key, resolved, preview: address.kind === 'preview' }
})
