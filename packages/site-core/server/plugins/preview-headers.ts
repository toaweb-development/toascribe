// The page of a preview (`/?preview`, M2.1) goes with `Referrer-Policy: no-referrer`: nothing of it (an address, a draft's slug) is
// sent to a site a link on it leads to, and `private, no-store`. Set in beforeResponse, which runs after the security module has written its headers.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const url = getRequestURL(event)
    if (url.pathname !== '/' || !url.searchParams.has('preview')) return
    setResponseHeader(event, 'referrer-policy', 'no-referrer')
    // A draft shown through a bearer cookie: not kept in the browser's cache after the cookie is gone (security §3).
    setResponseHeader(event, 'cache-control', 'private, no-store')
  })
})
