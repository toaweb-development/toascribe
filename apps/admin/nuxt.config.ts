import { createHash } from 'node:crypto'

import { ADMIN_STYLE_ATTRIBUTES } from './csp-style-attributes.ts'

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
        'lucide:image',
        'lucide:settings',
        'lucide:users',
        'lucide:user',
        'lucide:log-out',
        'lucide:chevron-down',
        'lucide:menu',
        'lucide:x',
        'lucide:panel-left-close',
        'lucide:panel-left-open',
        'lucide:rotate-ccw',
        // The users list: the sort arrows, the page links (also first and last), the select-all box's dash, the search field and the page gap.
        'lucide:arrow-up',
        'lucide:arrow-down',
        'lucide:chevron-left',
        'lucide:chevron-right',
        'lucide:chevrons-left',
        'lucide:chevrons-right',
        'lucide:minus',
        'lucide:ellipsis',
        'lucide:search',
        // The editor prototype (M0.6): the blocks' icons (from their block.json), the block toolbar, formatting, the document toolbar.
        'lucide:pilcrow',
        'lucide:image',
        'lucide:columns-2',
        'lucide:columns-3',
        'lucide:plus',
        'lucide:trash-2',
        'lucide:bold',
        'lucide:italic',
        'lucide:code',
        'lucide:link',
        'lucide:replace',
        'lucide:undo-2',
        'lucide:redo-2',
        'lucide:save',
        'lucide:arrow-left',
        // The content lists and the editor (M1.1): the menu's Innlegg and Sider, the screen options, publish, the read-only lock.
        'lucide:pin',
        'lucide:file-text',
        'lucide:send',
        'lucide:lock',
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
  // only its own images and inline `data:` ones (the QR code of the two-factor set-up). Images from other addresses are brought into
  // the media library first (M1.2, Tor's decision after M0.6), so the editor shows none from another host either.
  security: {
    headers: {
      contentSecurityPolicy: {
        'img-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"],
        'style-src-attr': ["'unsafe-hashes'", ...ADMIN_STYLE_ATTRIBUTES.map(({ value }) => sha256(value))],
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
