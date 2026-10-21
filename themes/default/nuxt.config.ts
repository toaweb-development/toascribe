// The default theme as a Nuxt layer (docs/PLAN.md, «Arkitektur»). apps/site extends it.
// M0.1 proves the wiring only: Nuxt UI with its defaults, one component, no brand tokens yet.
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  // Nuxt UI, i18n, icon settings and the lint module come from nuxt-base.
  extends: ['@toascribe/nuxt-base'],
  // A layer's own CSS is referenced by absolute path; "~/" would point into the app that extends it.
  css: [fileURLToPath(new URL('./app/assets/theme/globals.css', import.meta.url))],
})
