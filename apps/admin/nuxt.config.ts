// What the admin shares with the site (Nuxt UI, i18n, the API layer, runtime config, head basics) is in nuxt-base.
export default defineNuxtConfig({
  extends: ['@toascribe/nuxt-base'],

  // The app's own messages (i18n/locales/nb.json): a layer's messages are only read when the layer lists the file. The
  // first layer's `language` wins when the module merges the entries of one code, so it is repeated here.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },
  css: ['~/assets/theme/globals.css'],

  app: {
    // The admin lives under /admin. The path is fixed, not a setting: the app is built with it and the Caddyfile routes
    // /admin and /setup there. A run-time NUXT_APP_BASE_URL would not move it unless the Caddyfile changed too.
    baseURL: '/admin',
    head: {
      // The admin is behind a login later and must never be indexed (seo: apps behind auth).
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    },
  },
})
