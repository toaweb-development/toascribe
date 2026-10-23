// The default theme is a Nuxt layer. It brings the global stylesheet and the components of the public pages, and it
// extends @toascribe/nuxt-base, which holds what the site shares with the admin (Nuxt UI, i18n, the API layer,
// runtime config, head basics). Layers listed first win, so an app setting beats the theme and the theme beats the base.
export default defineNuxtConfig({
  extends: ['@toascribe/theme-default'],

  // The app's own messages (i18n/locales/nb.json): a layer's messages are only read when the layer lists the file. The
  // first layer's `language` wins when the module merges the entries of one code, so it is repeated here.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },

  // The site's part of the security headers (K-314); the nonce CSP and the rest are in nuxt-base. What is different here:
  // - `img-src` takes any https image: themes and posts show pictures from other hosts (an avatar, an embedded post's
  //   picture) and the host is not known when the theme is written. Images cannot run script, and `data:` is for small inline ones.
  //   Scripts, styles, fonts and connections stay at 'self' (a theme that needs another host says so in its own manifest, later).
  // - `frame-ancestors 'none'`: nobody frames the site, the admin included, until the live preview of «Tilpass» (PLAN, phase 3)
  //   needs it (Tor's decision, M0.4). Then it becomes 'self' (admin and site share one origin behind Caddy) together with
  //   `X-Frame-Options: SAMEORIGIN`, and the site e2e changes with it. `X-Frame-Options: DENY` says the same to old browsers.
  security: {
    headers: {
      contentSecurityPolicy: {
        'img-src': ["'self'", 'data:', 'https:'],
        'frame-ancestors': ["'none'"],
      },
      xFrameOptions: 'DENY',
    },
  },
})
