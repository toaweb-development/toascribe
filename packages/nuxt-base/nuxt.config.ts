// The layer that apps/site and apps/admin share (and that the default theme extends). Everything both apps need
// once lives here: Nuxt UI and i18n, the API plugin and API layer, runtime config, icon settings and head basics.
// What differs stays in the app: the admin's base URL and robots rule, each app's pages and its own messages.

import { fileURLToPath } from 'node:url'

// The API's dev address. `nuxi dev` has no Caddy, so /api/** is proxied here and SSR calls it directly.
const DEV_API_ORIGIN = 'http://127.0.0.1:3001'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@nuxt/eslint', 'nuxt-security'],
  compatibilityDate: '2026-10-20',

  // The API layer is imported by name (useHealthApi), not by a path into the layer.
  imports: { dirs: ['lib/api'] },

  // Read the workspace libraries from src/, as the other packages do through their "source" export condition. An alias
  // is used and not that condition, because other packages (the @internationalized/date of Nuxt UI) export a "source"
  // condition too: it would make TypeScript check their .ts files with our strict options and Vite bundle them. The
  // alias reaches the typecheck (tsconfig paths), the Vite build and the Nitro build, so none needs the library's dist/.
  alias: {
    '@toascribe/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    // The block format and the editor model (M0.6); the admin's editor reads it.
    '@toascribe/blocks': fileURLToPath(new URL('../blocks/src/index.ts', import.meta.url)),
    // How the blocks look on the site (M1.3): the admin's preview draws them, the site's templates will (M1.4).
    '@toascribe/block-views': fileURLToPath(new URL('../block-views/src/index.ts', import.meta.url)),
  },

  typescript: {
    tsConfig: {
      // Typecheck the tests and the vitest config too; Nuxt's generated configs cover only app/, server/ and shared/.
      include: ['../test/**/*.ts'],
    },
    nodeTsConfig: { include: ['../vitest.config.ts'] },
  },

  // The UI is Norwegian bokmål only for now. The language is part of the page, not of the address: no /nb/ prefix.
  // Messages live in i18n/locales/nb.json of this layer and of each app; Nuxt merges them. Keys are English.
  i18n: {
    defaultLocale: 'nb',
    strategy: 'no_prefix',
    // English is the admin's second language (M1.8, K-330): the admin picks it from the profile or the site's language
    // (apps/admin/app/middleware/locale.global.ts). The site has bokmål only in phase 1, and never switches.
    locales: [
      { code: 'nb', language: 'nb', name: 'Norsk bokmål', file: 'nb.json' },
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
    ],
    // The language is chosen by the app, so no cookie is written and no browser language is detected.
    detectBrowserLanguage: false,
  },

  // Icons come from the build, never from api.iconify.design. Nuxt UI's loading spinner is the only icon the
  // pages use, and a scan does not find icons that Nuxt UI itself names, so it is listed.
  // `mode: 'svg'` draws them as inline <svg>. The default (css) puts each icon's style rule in a <style> that the browser adds
  // after load and that has no nonce, so an icon shown later (the eye of «Skjul passord») would not appear under the CSP.
  icon: {
    mode: 'svg',
    clientBundle: { icons: ['lucide:loader-circle'], scan: true },
    fallbackToApi: false,
    // The default path, /api/_nuxt_icon, would be routed to the API by the proxy.
    localApiEndpoint: '/_nuxt_icon',
  },

  // The security headers and the nonce CSP of both apps (K-314), set by the app and not by Caddy: a nonce is made for each
  // response, and Nuxt's inline scripts carry it. This is what the site and the admin have in common; each app adds what
  // differs (`img-src`, `frame-ancestors`, `X-Frame-Options`) in its own nuxt.config.ts, with its reason. The directives are
  // not repeated there: layers concatenate arrays, and a repeated value would only be listed twice.
  security: {
    nonce: true,
    // The API owns rate limits, request sizes and cross-origin rules (api: security §3, K-258), and Caddy sits in front. The apps
    // are pages only: a limiter would count the container health check and a whole office behind one proxy address as one
    // visitor, and refuse them.
    rateLimiter: false,
    // The apps take no request bodies but one: the site's password form (/_toascribe/unlock), which caps its own (8 KiB, and Caddy
    // with it).
    requestSizeLimiter: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    // Scans the query string for markup and answers 400. Vue escapes every value it prints, and the values read from the
    // query (`redirectTo`, the notices, later a search term) are never printed as markup; a false positive would lock a person
    // out of a page.
    xssValidator: false,
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'none'"],
        'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'nonce-{{nonce}}'"],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        // Left off on purpose: it would send every request of an installation on plain http (a home server, a LAN address)
        // to https and break it. TLS is the proxy's job, and HSTS (server/plugins/security.ts) follows it.
        'upgrade-insecure-requests': false,
      },
      // Sent by server/plugins/security.ts, and only when the request came in over https.
      strictTransportSecurity: false,
      referrerPolicy: 'strict-origin-when-cross-origin',
    },
  },

  app: {
    head: {
      // Zod 4 compiles a faster parser with `new Function`, after trying whether the browser allows it. Under this CSP the try is
      // refused, and the browser reports it as a violation even though Zod catches it. Zod reads `globalThis.__zod_globalConfig`
      // when the first object schema is built, which is when the shared package's module is evaluated, before any plugin can
      // call `z.config`. So the flag is set by an inline script that runs first (it gets the nonce like Nuxt's own).
      script: [{ innerHTML: 'globalThis.__zod_globalConfig = { jitless: true }', tagPosition: 'head' }],
      // No favicon yet (it needs the brand). An empty icon stops the browser asking for /favicon.ico, which 404s.
      link: [{ rel: 'icon', href: 'data:,' }],
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
    },
  },

  runtimeConfig: {
    // Server only (env NUXT_API_URL_INTERNAL): where SSR reaches the API, e.g. http://api:3001. Empty = not set.
    apiUrlInternal: '',
    // Server only (M1.8, K-297): the log level (env NUXT_LOG_LEVEL) and TOASCRIBE_DEBUG (env NUXT_TOASCRIBE_DEBUG, `1` = debug lines
    // and the stack of an unhandled error in the log; never in a response).
    logLevel: 'info',
    toascribeDebug: '',
    // Which app writes the log line (`toascribe-site`, `toascribe-admin`); each app sets its own.
    appName: 'nuxt',
    public: {
      // Browser: the API is same-origin and Caddy routes /api/** to it (env NUXT_PUBLIC_API_BASE).
      apiBase: '/api',
      // True in the app that has the setup wizard page (the admin); the others send visitors to it until the site is installed
      // (app/middleware/setup-redirect.global.ts).
      hostsSetupWizard: false,
    },
  },

  $development: {
    runtimeConfig: { apiUrlInternal: DEV_API_ORIGIN },
    nitro: {
      devProxy: { '/api': { target: `${DEV_API_ORIGIN}/api`, changeOrigin: true } },
    },
    // `nuxi dev` only: Vite puts each component's CSS into the page as a <style> element with no nonce (that is how its hot
    // reload works), and the strict style-src would block all of it. `style-src-elem` covers <style> elements and takes the
    // place of `style-src` for them; the build ships real CSS files, which is what the strict policy above is checked against
    // (apps/admin/e2e).
    security: { headers: { contentSecurityPolicy: { 'style-src-elem': ["'self'", "'unsafe-inline'"] } } },
  },
})
