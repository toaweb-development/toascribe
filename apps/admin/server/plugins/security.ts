// What nuxt-security does not do for the admin (K-314):
// - HSTS, only when the browser reached us over https. Behind the proxy this app sees plain http, so the scheme comes from
//   X-Forwarded-Proto, which Caddy passes on from the one trusted proxy and otherwise replaces with what it saw itself.
//   Over plain http a browser ignores the header anyway, so a forged value does no harm.
// - `Cache-Control: no-store` on every page we render: the nonce in it is made for one response, and a cached copy would
//   carry a nonce the new CSP header does not have. Assets under /_nuxt are not rendered here and keep their long cache.
// - The empty `style=""` of Iconify's server-rendered icons, which the strict CSP would report (server/utils/security.ts).
//   Nothing else in the sign-in screens has a style attribute in the HTML (checked in a browser), so style-src-attr stays at
//   the strict default. A later screen that needs real inline styles opens `style-src-attr` in nuxt.config.ts, with its reason.
// - `X-Robots-Tag`, next to the meta tag: the admin is never indexed.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (typeof response.body === 'string') {
      response.body = withoutEmptyStyleAttributes(response.body)
    }
    setResponseHeader(event, 'cache-control', 'no-store')
    setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
    const hsts = hstsFor(getRequestHeader(event, 'x-forwarded-proto'))
    if (hsts !== undefined) {
      setResponseHeader(event, 'strict-transport-security', hsts)
    }
  })
})
