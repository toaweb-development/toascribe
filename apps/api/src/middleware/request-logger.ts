import type { MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'

import type { AppEnv } from '../lib/env.ts'

/** Probes run every few seconds; their successful lines would drown the log. */
const QUIET_PATHS = new Set(['/api/health', '/api/ready'])

/**
 * Puts a child logger with the request id on the context (so every line written during the request
 * carries it) and writes one line per request. It logs the method, the path (no query string, which
 * can carry tokens), the status and the duration; never headers or bodies (security §8).
 * Must run after hono/request-id.
 */
export function requestLogger(root: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const logger = root.child({ requestId: c.get('requestId') })
    c.set('logger', logger)
    const start = performance.now()
    await next()
    const status = c.res.status
    const fields = {
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: Math.round(performance.now() - start),
    }
    if (status >= 500) {
      logger.error(fields, 'request failed')
    } else if (status >= 400) {
      logger.warn(fields, 'request rejected')
    } else if (QUIET_PATHS.has(c.req.path)) {
      logger.debug(fields, 'request')
    } else {
      logger.info(fields, 'request')
    }
  }
}
