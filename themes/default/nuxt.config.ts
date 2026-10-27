// The default theme as a Nuxt layer (M1.4; PLAN «Temaspesifikasjon og installasjon»): theme.json, the templates of WordPress'
// hierarchy under app/templates, a layout with ScribeHead and ScribeFooter, and the look of every core block. It extends the core
// of the site (@toascribe/site-core: the theme SDK, the catch-all route); apps/site extends it when toascribe.toml names it.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  extends: ['@toascribe/site-core'],
  // A layer's own CSS is referenced by absolute path; "~/" would point into the app that extends it.
  // How each core block looks (the block views' class contract under themeApi 1) comes first, then the theme's frame and lists.
  // Resolved by the package's own export: '@toascribe/block-views' is an alias to its source in the apps.
  css: [
    createRequire(import.meta.url).resolve('@toascribe/block-views/styles.css'),
    fileURLToPath(new URL('./app/assets/theme/globals.css', import.meta.url)),
  ],
  // The theme's messages (i18n/locales/nb.json): a layer's file is only read when the layer lists it.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },
})
