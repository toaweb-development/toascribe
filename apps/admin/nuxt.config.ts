// What the admin shares with the site (Nuxt UI, i18n, the API layer, runtime config, head basics) is in nuxt-base.
export default defineNuxtConfig({
  extends: ['@toascribe/nuxt-base'],

  // The app's own messages (i18n/locales/nb.json): a layer's messages are only read when the layer lists the file. The
  // first layer's `language` wins when the module merges the entries of one code, so it is repeated here.
  i18n: { locales: [{ code: 'nb', language: 'nb', file: 'nb.json' }] },

  // The end-to-end tests and the Playwright config are TypeScript too (e2e/README.md): typecheck them with the app.
  typescript: {
    tsConfig: { include: ['../e2e/**/*.ts'] },
    nodeTsConfig: { include: ['../playwright.config.ts'] },
  },

  css: ['~/assets/theme/globals.css'],

  // Nuxt UI draws its own icons by name, and the scan of the sources does not see those: the ones the sign-in screens
  // show are listed. They come from the build, never from api.iconify.design.
  icon: { clientBundle: { icons: ['lucide:eye', 'lucide:eye-off', 'lucide:check'] } },

  // The admin's part of the security headers (K-314); the rest is in nuxt-base. Nobody frames the admin, and its pages show
  // only its own images and inline `data:` ones (the QR code of the two-factor set-up).
  security: {
    headers: {
      contentSecurityPolicy: {
        'img-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"],
      },
      xFrameOptions: 'DENY',
    },
  },

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
