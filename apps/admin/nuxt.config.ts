import { createHash } from 'node:crypto'

// The inline styles of the shell that the server draws. Nuxt UI's dashboard sidebar writes its width as a style attribute
// (`style="--width:15rem;"`; `0rem` while it is collapsed) and Reka UI's accordion, which opens the menu's sections, writes its
// content size as another. Both are in the HTML the server sends, and the strict CSP would refuse every inline style attribute. They
// are let through by their hash and nothing else (`style-src-attr` with `'unsafe-hashes'`): the page has no way to add a style attribute
// of its own. A new Nuxt UI or Reka UI version that writes another string fails the end-to-end tests (a CSP violation fails them).
const SHELL_STYLE_ATTRIBUTES = [
  '--width:15rem;',
  '--width:0rem;',
  '--reka-accordion-content-width:var(--reka-collapsible-content-width);--reka-accordion-content-height:var(--reka-collapsible-content-height);--reka-collapsible-content-height:0px;--reka-collapsible-content-width:0px;',
]
const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

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

  // Nuxt UI draws its own icons by name, and the scan of the sources does not see those: the ones the sign-in screens, the setup
  // wizard and the shell show are listed. They come from the build, never from api.iconify.design. The menu's icons are named by
  // the api (`i-lucide-gauge`, ...), which no scan of the sources can see either: every icon a menu item may name is here.
  icon: {
    clientBundle: {
      icons: [
        'lucide:eye',
        'lucide:eye-off',
        'lucide:check',
        'lucide:circle-check',
        'lucide:circle-x',
        'lucide:triangle-alert',
        'lucide:info',
        // The shell: the menu (the registry's icons), the user menu, the sidebar's buttons and the menu's own arrow.
        'lucide:gauge',
        'lucide:users',
        'lucide:user',
        'lucide:log-out',
        'lucide:chevron-down',
        'lucide:menu',
        'lucide:x',
        'lucide:panel-left-close',
        'lucide:panel-left-open',
        'lucide:rotate-ccw',
        // The users list: the sort arrows, the page links, the search field and the page gap.
        'lucide:arrow-up',
        'lucide:arrow-down',
        'lucide:chevron-left',
        'lucide:chevron-right',
        'lucide:ellipsis',
        'lucide:search',
      ],
    },
  },

  // The colour mode (the admin colour schemes force light or dark) is kept in a cookie and not in localStorage: the server reads
  // it, and the module's inline script reads it before the first paint, so a reload does not flash the other mode.
  // `disableTransition` is off because the module's way of doing it adds a `<style>` with no nonce whenever the mode changes in
  // the browser (a scheme saved on the profile page, or the shell left), which the strict CSP refuses. Nuxt UI's colours fade in 150 ms.
  colorMode: { storage: 'cookie', disableTransition: false },

  // This app has the setup wizard; the site sends visitors here until the site is installed (nuxt-base: setup-redirect.global.ts).
  runtimeConfig: { public: { hostsSetupWizard: true } },

  // The admin's part of the security headers (K-314); the rest is in nuxt-base. Nobody frames the admin, and its pages show
  // only its own images and inline `data:` ones (the QR code of the two-factor set-up).
  security: {
    headers: {
      contentSecurityPolicy: {
        'img-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"],
        'style-src-attr': ["'unsafe-hashes'", ...SHELL_STYLE_ATTRIBUTES.map(sha256)],
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
