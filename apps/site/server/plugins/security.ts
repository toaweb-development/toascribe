// What is only true of the public site (the rest, HSTS and the Iconify style fix, is in nuxt-base: server/plugins/security.ts):
// - `Cache-Control: private, no-cache` on every page we render. The CSP nonce is made for one response and sits in the page and
//   in the header; a shared cache (a CDN, a proxy) that handed the same page to others would hand out a nonce that anyone can
//   read, and a nonce that is known protects nothing. `private` keeps shared caches out; `no-cache` makes the browser ask
//   again. Assets under /_nuxt are not rendered here and keep their long cache. When the site gets a page cache, this line
//   is the one to change: AGENTS.md, «Public site: CSP and caching».
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (_response, { event }) => {
    setResponseHeader(event, 'cache-control', 'private, no-cache')
  })
})
