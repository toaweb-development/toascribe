// The API's dev address. `nuxi dev` has no Caddy, so /api/** is proxied here and SSR calls it directly.
const DEV_API_ORIGIN = 'http://127.0.0.1:3001'

export default defineNuxtConfig({
  // The default theme is a Nuxt layer; it brings Nuxt UI and the global stylesheet.
  extends: ['@toascribe/theme-default'],
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  compatibilityDate: '2026-10-20',

  typescript: {
    // Typecheck the tests and the vitest config too; Nuxt's generated configs cover only app/, server/ and shared/.
    tsConfig: { include: ['../test/**/*.ts'] },
    nodeTsConfig: { include: ['../vitest.config.ts'] },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'nb' },
      // No favicon yet (it needs the brand). An empty icon stops the browser asking for /favicon.ico, which 404s.
      link: [{ rel: 'icon', href: 'data:,' }],
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
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
