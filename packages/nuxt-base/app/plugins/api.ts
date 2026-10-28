import type { ApiRequestError } from '../lib/api/errors.ts'

declare module '#app' {
  interface RuntimeNuxtHooks {
    /**
     * A call found that the session is gone (401 `unauthorized` or `mfa_required`). The app that has a login screen listens
     * and sends the person there; an app with none (the site) ignores it.
     */
    'api:unauthorized': (error: ApiRequestError) => void | Promise<void>
  }
}

// The one $fetch instance for the API (nuxt-vue §6). $fetch itself is deliberately not configurable
// globally in Nuxt, so this plugin provides a configured copy as `$api`: session cookie, CSRF token, error type (lib/api/client.ts).
// `$csrf` is the token held in memory; only the sign-in code changes it (useAuth).
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()

  // In the browser the API is same-origin, `/api` through the proxy. During SSR there is no browser to
  // resolve that path, so the server calls the API on its internal address (env NUXT_API_URL_INTERNAL).
  // If that is empty, SSR falls back to the relative path, the call fails and the page shows its error state.
  const internal = import.meta.server ? config.apiUrlInternal.replace(/\/+$/, '') : ''
  const baseURL = internal === '' ? config.public.apiBase : `${internal}${config.public.apiBase}`

  // $fetch does not send the visitor's cookies when it renders on the server, so the page request's cookie is forwarded:
  // without it the API sees nobody signed in on the first load.
  const cookie = import.meta.server ? useRequestHeaders(['cookie']).cookie : undefined
  // The page request's id goes with the server's calls, so the api's lines carry it (M1.8, K-297; server/plugins/logging.ts).
  const requestId = import.meta.server ? useRequestEvent()?.context['requestId'] : undefined
  const forwarded = {
    ...(cookie === undefined ? {} : { cookie }),
    ...(typeof requestId === 'string' ? { 'x-request-id': requestId } : {}),
  }

  const csrf = createCsrfStore()
  const api = createApiClient({
    create: (defaults) => $fetch.create(defaults),
    baseURL,
    headers: Object.keys(forwarded).length === 0 ? undefined : forwarded,
    csrf,
    isClient: import.meta.client,
    onUnauthorized: (error) => {
      void nuxtApp.callHook('api:unauthorized', error)
    },
  })

  return { provide: { api, csrf } }
})
