// The core of the public site as a Nuxt layer (M1.4): the theme SDK (useContent, useQuery, useMenu, useArea, useSettings,
// useUser), the core components (ScribeHead, ScribeFooter, ScribeBlocks, the pagination, the password form and the search form),
// the catch-all route that asks the api what an address is and draws the template the theme has for it, and the theme module.
// A theme extends this layer, a child theme extends its parent, and apps/site extends the theme chosen in toascribe.toml.
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  extends: ['@toascribe/nuxt-base'],
  modules: [fileURLToPath(new URL('./modules/theme.ts', import.meta.url))],

  runtimeConfig: {
    // Server only (env NUXT_CACHE_VALKEY_URL, e.g. redis://valkey:6379): the shared data cache of several site instances. Empty: each
    // instance keeps its cache in its own memory (server/utils/data-cache.ts).
    cacheValkeyUrl: '',
  },

  // The layer's own messages: a layer's message file is only read when the layer lists it.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },
})
