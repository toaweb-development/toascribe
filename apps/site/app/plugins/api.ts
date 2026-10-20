// The one $fetch instance for the API (nuxt-vue §6). $fetch itself is deliberately not configurable
// globally in Nuxt, so this plugin provides a configured copy as `$api`.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  // In the browser the API is same-origin, `/api` through the proxy. During SSR there is no browser to
  // resolve that path, so the server calls the API on its internal address (env NUXT_API_URL_INTERNAL).
  // If that is empty, SSR falls back to the relative path, the call fails and the page shows its error state.
  const internal = import.meta.server ? config.apiUrlInternal.replace(/\/+$/, '') : ''
  const baseURL = internal === '' ? config.public.apiBase : `${internal}${config.public.apiBase}`

  // A hung API must not hang the page: give up after 3 s, and never retry.
  const api = $fetch.create({ baseURL, timeout: 3000, retry: false })

  return { provide: { api } }
})
