// What nuxt-security does not do for either app (K-314), so the site and the admin send the same thing:
// - HSTS, only when the browser reached us over https. Behind the proxy this app sees plain http, so the scheme comes from
//   X-Forwarded-Proto, which Caddy passes on from the one trusted proxy and otherwise replaces with what it saw itself.
//   Over plain http a browser ignores the header anyway, so a forged value does no harm.
// - The empty `style=""` of Iconify's server-rendered icons, which the strict CSP would report (server/utils/security.ts).
//   Nothing else in the pages has a style attribute in the HTML (checked in a browser), so style-src-attr stays at the strict
//   default. A later screen that needs real inline styles opens `style-src-attr` in nuxt.config.ts, with its reason.
// What differs stays in the app: the admin's `no-store` and `X-Robots-Tag`, the site's cache rule (server/plugins/security.ts there).
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (typeof response.body === 'string') {
      response.body = withoutEmptyStyleAttributes(response.body)
    }
    const hsts = hstsFor(getRequestHeader(event, 'x-forwarded-proto'))
    if (hsts !== undefined) {
      setResponseHeader(event, 'strict-transport-security', hsts)
    }
  })
})
