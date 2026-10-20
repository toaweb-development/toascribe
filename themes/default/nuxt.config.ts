// The default theme as a Nuxt layer (docs/PLAN.md, «Arkitektur»). apps/site extends it.
// M0.1 proves the wiring only: Nuxt UI with its defaults, one component, no brand tokens yet.
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  // @nuxt/eslint generates .nuxt/eslint.config.mjs, which this layer's own `eslint .` reads.
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  // A layer's own CSS is referenced by absolute path; "~/" would point into the app that extends it.
  css: [fileURLToPath(new URL('./app/assets/theme/globals.css', import.meta.url))],
  compatibilityDate: '2026-10-20',

  // Icons come from the build, never from api.iconify.design. Nuxt UI's loading spinner is the only icon the
  // pages use, and a scan does not find icons that Nuxt UI itself names, so it is listed.
  icon: {
    clientBundle: { icons: ['lucide:loader-circle'], scan: true },
    fallbackToApi: false,
    // The default path, /api/_nuxt_icon, would be routed to the API by the proxy.
    localApiEndpoint: '/_nuxt_icon',
  },
})
