import { OpenAPIHono } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import type { Logger } from 'pino'

import { apiError } from './lib/api-error.ts'
import type { AppEnv } from './lib/env.ts'
import { onError, onNotFound } from './middleware/errors.ts'
import { requestLogger } from './middleware/request-logger.ts'
import type { Pool } from './repositories/health.ts'
import { createHealthApp } from './routes/health.ts'

/** Everything the app needs from outside, so tests can inject their own. */
export interface AppDeps {
  readonly pool: Pool
  readonly logger: Logger
  /** The repo version, shown on /api/health and in the OpenAPI document. */
  readonly version: string
}

/**
 * A hard cap on request bodies, a safety limit and not a setting (APP_CONFIG: an absolute limit
 * may be a constant). The proxy limits too; uploads will get their own larger limit on their routes.
 */
export const BODY_LIMIT_BYTES = 1024 * 1024

export const OPENAPI_PATH = '/api/v1/openapi.json'

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({
    // A request that fails validation gets the common error format, not the library default.
    defaultHook: (result, c) => {
      if (!result.success) {
        const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(body)'))]
        return c.json(apiError('validation_error', `Invalid request: ${fields.join(', ')}`, c.get('requestId')), 400)
      }
      return undefined
    },
  })

  // Order matters: the request id first (it is on every log line), then the logger that carries it.
  app.use(requestId())
  app.use(requestLogger(deps.logger))
  app.use(
    secureHeaders({
      xFrameOptions: 'DENY',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
      // A JSON API: nothing it returns should load or embed anything (security §7).
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  )
  app.use(
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json(apiError('payload_too_large', 'Request body too large', c.get('requestId')), 413),
    }),
  )

  // Not in M0.1: CSRF and CORS. CORS stays off by default (PLAN.md, «API-versjonering»), and CSRF
  // arrives with login and cookie sessions in M0.3 (typescript §12). With no cookie auth yet there
  // is nothing for CSRF to protect.

  app.route('/api', createHealthApp({ pool: deps.pool, version: deps.version }))

  app.doc31(OPENAPI_PATH, {
    openapi: '3.1.0',
    info: { title: 'toascribe API', version: deps.version },
  })

  app.notFound(onNotFound)
  app.onError(onError)
  return app
}
