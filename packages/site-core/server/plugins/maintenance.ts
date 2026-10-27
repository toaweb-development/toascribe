// Maintenance mode (M1.7, K-288): the page the middleware turned into the maintenance page (503) gets its Retry-After here, once
// the renderer has written its headers.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (_response, { event }) => {
    const retryAfter: unknown = event.context['scribeRetryAfter']
    if (typeof retryAfter === 'number') setResponseHeader(event, 'retry-after', retryAfter)
  })
})
