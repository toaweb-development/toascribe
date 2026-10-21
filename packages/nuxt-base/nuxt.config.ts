// The layer that apps/site and apps/admin share (and that the default theme extends). Everything both apps need
// once lives here: Nuxt UI and i18n, the API plugin and API layer, runtime config, icon settings and head basics.
// What differs stays in the app: the admin's base URL and robots rule, each app's pages and its own messages.

import { fileURLToPath } from 'node:url'

// The API's dev address. `nuxi dev` has no Caddy, so /api/** is proxied here and SSR calls it directly.
const DEV_API_ORIGIN = 'http://127.0.0.1:3001'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@nuxt/eslint'],
  compatibilityDate: '2026-10-20',

  // The API layer is imported by name (useHealthApi), not by a path into the layer.
  imports: { dirs: ['lib/api'] },

  // Read the workspace libraries from src/, as the other packages do through their "source" export condition. An alias
  // is used and not that condition, because other packages (the @internationalized/date of Nuxt UI) export a "source"
  // condition too: it would make TypeScript check their .ts files with our strict options and Vite bundle them. The
  // alias reaches the typecheck (tsconfig paths), the Vite build and the Nitro build, so none needs the library's dist/.
  alias: { '@toascribe/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },

  typescript: {
    tsConfig: {
      // Typecheck the tests and the vitest config too; Nuxt's generated configs cover only app/, server/ and shared/.
      include: ['../test/**/*.ts'],
    },
    nodeTsConfig: { include: ['../vitest.config.ts'] },
  },

  // The UI is Norwegian bokmål only for now. The language is part of the page, not of the address: no /nb/ prefix.
  // Messages live in i18n/locales/nb.json of this layer and of each app; Nuxt merges them. Keys are English.
  i18n: {
    defaultLocale: 'nb',
    strategy: 'no_prefix',
    locales: [{ code: 'nb', language: 'nb', name: 'Norsk bokmål', file: 'nb.json' }],
    // The language is fixed, so no cookie is written and no browser language is detected.
    detectBrowserLanguage: false,
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
    head: {
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
