// What is only true of the admin (the rest, HSTS and the Iconify style fix, is in nuxt-base: server/plugins/security.ts):
// - `Cache-Control: no-store` on every page we render: the nonce in it is made for one response, and a cached copy would
//   carry a nonce the new CSP header does not have. Assets under /_nuxt are not rendered here and keep their long cache.
// - `X-Robots-Tag`, next to the meta tag: the admin is never indexed.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (_response, { event }) => {
    setResponseHeader(event, 'cache-control', 'no-store')
    setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow')
  })
})
