// A request id for every request to the site or the admin, and one log line when it is answered (M1.8, K-297). The id is the one
// the visitor's request came with when it is a valid one (Caddy passes X-Request-Id on), or a new one; it goes back in the response
// and with every call the server makes to the api (app/plugins/api.ts, site-core public-api.ts), so the api's lines and the jobs it
// queues carry the same id. The path is logged without its query string (it can carry tokens); never headers or bodies.
import { randomUUID } from 'node:crypto'

import { REQUEST_ID_PATTERN } from '@toascribe/shared'

const QUIET = /^\/(?:admin\/)?(?:_nuxt|__nuxt_error|healthz)/

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const incoming = getRequestHeader(event, 'x-request-id')
    const requestId = incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
    event.context['requestId'] = requestId
    event.context['requestStart'] = performance.now()
    setResponseHeader(event, 'x-request-id', requestId)
  })

  nitroApp.hooks.hook('afterResponse', (event) => {
    const start = event.context['requestStart']
    const status = getResponseStatus(event)
    const path = event.path.split('?')[0] ?? '/'
    const fields = {
      requestId: event.context['requestId'],
      method: event.method,
      path,
      status,
      durationMs: typeof start === 'number' ? Math.round(performance.now() - start) : undefined,
    }
    if (status >= 500) logLine('error', fields, 'request failed')
    else if (status >= 400) logLine('warn', fields, 'request rejected')
    else logLine(QUIET.test(path) ? 'debug' : 'info', fields, 'request')
  })

  nitroApp.hooks.hook('error', (error, { event }) => {
    // The kind of error and its scrubbed message; the stack only with TOASCRIBE_DEBUG=1, and never in a response.
    const debug = useRuntimeConfig().toascribeDebug === '1'
    const status: unknown = Reflect.get(error, 'statusCode')
    logLine(
      typeof status === 'number' && status < 500 ? 'warn' : 'error',
      {
        requestId: event?.context['requestId'],
        err: {
          name: error.name,
          message: error.message,
          ...(debug && error.stack !== undefined ? { stack: error.stack } : {}),
        },
      },
      'unhandled error',
    )
  })
})
