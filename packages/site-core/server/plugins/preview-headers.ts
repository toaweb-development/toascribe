// The page of a preview (`/?preview`, M2.1) goes with `Referrer-Policy: no-referrer`: nothing of it (an address, a draft's slug) is
// sent to a site a link on it leads to. Set in beforeResponse, which runs after the security module has written its headers.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (getRequestURL(event).searchParams.has('preview')) setResponseHeader(event, 'referrer-policy', 'no-referrer')
  })
})
