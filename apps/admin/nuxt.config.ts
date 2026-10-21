// What the admin shares with the site (Nuxt UI, i18n, the API layer, runtime config, head basics) is in nuxt-base.
export default defineNuxtConfig({
  extends: ['@toascribe/nuxt-base'],
  modules: ['nuxt-security'],

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
  // `mode: 'svg'` draws them as inline <svg>. The default (css) puts each icon's style rule in a <style> that the browser adds
  // after load and that has no nonce, so an icon shown later (the eye of «Skjul passord») would not appear under the CSP.
  icon: { mode: 'svg', clientBundle: { icons: ['lucide:eye', 'lucide:eye-off', 'lucide:check'] } },

  // The admin's security headers and its CSP (K-314), set by the app and not by Caddy: a nonce is made for each response, and
  // Nuxt's inline scripts carry it. The reasons are beside each setting.
  security: {
    nonce: true,
    // The API owns rate limits, request sizes and cross-origin rules (api: security §3, K-258), and Caddy sits in front. The admin
    // is pages only: its limiter would count the container health check and a whole office behind one proxy address as one
    // visitor, and refuse them.
    rateLimiter: false,
    requestSizeLimiter: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    // Scans the query string for markup and answers 400. Vue escapes every value it prints, and `redirectTo` and the notices
    // in the query are the only values read; a false positive would lock a person out of the login screen.
    xssValidator: false,
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'none'"],
        'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'nonce-{{nonce}}'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        // Left off on purpose: it would send every request of an installation on plain http (a home server, a LAN address)
        // to https and break it. TLS is the proxy's job, and HSTS (server/plugins/security.ts) follows it.
        'upgrade-insecure-requests': false,
      },
      // Sent by server/plugins/security.ts, and only when the request came in over https.
      strictTransportSecurity: false,
      referrerPolicy: 'strict-origin-when-cross-origin',
      xFrameOptions: 'DENY',
    },
  },

  // `nuxi dev` only: Vite puts each component's CSS into the page as a <style> element with no nonce (that is how its hot reload
  // works), and the strict style-src would block all of it. `style-src-elem` covers <style> elements and takes the place of
  // `style-src` for them; the build ships real CSS files, which is what the strict policy above is checked against
  // (apps/admin/e2e).
  $development: {
    security: { headers: { contentSecurityPolicy: { 'style-src-elem': ["'self'", "'unsafe-inline'"] } } },
  },

  app: {
    // The admin lives under /admin. The path is fixed, not a setting: the app is built with it and the Caddyfile routes
    // /admin and /setup there. A run-time NUXT_APP_BASE_URL would not move it unless the Caddyfile changed too.
    baseURL: '/admin',
    head: {
      // Zod 4 compiles a faster parser with `new Function`, after trying whether the browser allows it. Under this CSP the try is
      // refused, and the browser reports it as a violation even though Zod catches it. Zod reads `globalThis.__zod_globalConfig`
      // when the first object schema is built, which is when the shared package's module is evaluated, before any plugin can
      // call `z.config`. So the flag is set by an inline script that runs first (it gets the nonce like Nuxt's own).
      script: [{ innerHTML: 'globalThis.__zod_globalConfig = { jitless: true }', tagPosition: 'head' }],
      // The admin is behind a login later and must never be indexed (seo: apps behind auth).
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    },
  },
})
