// The API's dev address. `nuxi dev` has no Caddy, so /api/** is proxied here and SSR calls it directly.
const DEV_API_ORIGIN = 'http://127.0.0.1:3001'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/theme/globals.css'],
  compatibilityDate: '2026-10-20',

  typescript: {
    // Typecheck the tests and the vitest config too; Nuxt's generated configs cover only app/, server/ and shared/.
    tsConfig: { include: ['../test/**/*.ts'] },
    nodeTsConfig: { include: ['../vitest.config.ts'] },
  },

  // Icons come from the build, never from api.iconify.design. Nuxt UI's loading spinner is the only icon the
  // pages use, and a scan does not find icons that Nuxt UI itself names, so it is listed.
  icon: {
    clientBundle: { icons: ['lucide:loader-circle'], scan: true },
    fallbackToApi: false,
    // The default path, /api/_nuxt_icon, would be routed to the API by the proxy.
    localApiEndpoint: '/_nuxt_icon',
  },

  app: {
    // Admin lives under /admin (env NUXT_APP_BASE_URL overrides it at runtime).
    baseURL: '/admin',
    head: {
      htmlAttrs: { lang: 'nb' },
      // No favicon yet (it needs the brand). An empty icon stops the browser asking for /favicon.ico, which 404s.
      link: [{ rel: 'icon', href: 'data:,' }],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Admin is behind a login later and must never be indexed (seo: apps behind auth).
        { name: 'robots', content: 'noindex, nofollow' },
      ],
    },
  },

  runtimeConfig: {
    // Server only (env NUXT_API_URL_INTERNAL): where SSR reaches the API, e.g. http://api:3001. Empty = not set.
    apiUrlInternal: '',
    public: {
      // Browser: the API is same-origin and Caddy routes /api/** to it (env NUXT_PUBLIC_API_BASE).
      apiBase: '/api',
    },
  },

  $development: {
    runtimeConfig: { apiUrlInternal: DEV_API_ORIGIN },
    nitro: {
      devProxy: { '/api': { target: `${DEV_API_ORIGIN}/api`, changeOrigin: true } },
    },
  },
})
