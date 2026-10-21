// The default theme is a Nuxt layer. It brings the global stylesheet and the components of the public pages, and it
// extends @toascribe/nuxt-base, which holds what the site shares with the admin (Nuxt UI, i18n, the API layer,
// runtime config, head basics). Layers listed first win, so an app setting beats the theme and the theme beats the base.
export default defineNuxtConfig({
  extends: ['@toascribe/theme-default'],

  // The app's own messages (i18n/locales/nb.json): a layer's messages are only read when the layer lists the file. The
  // first layer's `language` wins when the module merges the entries of one code, so it is repeated here.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },
})
