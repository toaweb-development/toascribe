import { OpenAPIHono } from '@hono/zod-openapi'
import { dummyPasswordHash } from '@toascribe/auth'
import type { Database } from '@toascribe/db'
import type { KeyRing } from '@toascribe/shared'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import type { Logger } from 'pino'

import { apiError } from './lib/api-error.ts'
import type { AppEnv } from './lib/env.ts'
import { publicAccess } from './lib/policy.ts'
import { authContext } from './middleware/auth.ts'
import { onError, onNotFound } from './middleware/errors.ts'
import { annotatePolicies, findUnguardedRoutes, policyGuard } from './middleware/policy.ts'
import { requestLogger } from './middleware/request-logger.ts'
import type { MailPort } from './ports/mail.ts'
import type { Pool } from './repositories/health.ts'
import { createAuthApp } from './routes/auth.ts'
import { createHealthApp } from './routes/health.ts'
import { createMeApp } from './routes/me.ts'
import { createSecurityApp } from './routes/security.ts'
import { createSystemApp } from './routes/system.ts'
import { createServices } from './services/index.ts'

/** Everything the app needs from outside, so tests can inject their own. */
export interface AppDeps {
  readonly pool: Pool
  readonly db: Database
  readonly logger: Logger
  /** The repo version, shown on /api/health and in the OpenAPI document. */
  readonly version: string
  /** PUBLIC_ORIGIN: the address visitors use. State-changing requests must come from it, and HSTS follows its scheme. */
  readonly publicOrigin: string
  /** TOASCRIBE_SIGNING_KEY: signs the CSRF tokens. */
  readonly signingKey: Uint8Array
  /** TOASCRIBE_ENCRYPTION_KEY and the older keys. */
  readonly keyRing: KeyRing
  /** Where the account flows send mail. */
  readonly mail: MailPort
  /** How long the account flows that hide whether an account exists take at least (ms). Tests set 0. Default: lib/timing.ts. */
  readonly minimumResponseMs?: number
  /** TOASCRIBE_TRUSTED_PROXY as set (empty when it is not). Empty makes the api watch its first requests and warn (services/proxy-check.ts). */
  readonly trustedProxy?: string
  /** The clock, for the session lifetimes and the waits after failed logins. Tests set it; the default is the real time. */
  readonly clock?: () => Date
}

/**
 * A hard cap on request bodies, a safety limit and not a setting (APP_CONFIG: an absolute limit
 * may be a constant). The proxy limits too; uploads will get their own larger limit on their routes.
 */
export const BODY_LIMIT_BYTES = 1024 * 1024

export const OPENAPI_PATH = '/api/v1/openapi.json'

export function createApp(deps: AppDeps) {
  return buildApp(deps).app
}

/** Builds the app and returns it with the services behind it (for tests, and for code that runs other flows on the same services). */
export function buildApp(deps: AppDeps) {
  const publicOrigin = new URL(deps.publicOrigin).origin
  const services = createServices({
    db: deps.db,
    clock: deps.clock ?? (() => new Date()),
    signingKey: deps.signingKey,
    keyRing: deps.keyRing,
    mail: deps.mail,
    logger: deps.logger,
    publicOrigin,
    ...(deps.trustedProxy === undefined ? {} : { trustedProxy: deps.trustedProxy }),
    ...(deps.minimumResponseMs === undefined ? {} : { minimumResponseMs: deps.minimumResponseMs }),
    onInvalidSetting: (key) => {
      deps.logger.warn({ key }, 'a stored setting is invalid; the default is used')
    },
  })
  // The first login for an account that does not exist would otherwise pay for making the dummy hash.
  void dummyPasswordHash().catch((err: unknown) => {
    deps.logger.error({ err }, 'could not prepare the dummy password hash')
  })

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
  // Looks at the address the proxy says the visitor has, to warn when the stack is not told who its visitors are.
  app.use(async (c, next) => {
    services.proxy.observe(c.req.header('x-real-ip'))
    await next()
  })
  app.use(
    secureHeaders({
      xFrameOptions: 'DENY',
      // Only where the site is served over HTTPS: a browser that sees HSTS on plain HTTP ignores it, but a local
      // http://localhost setup should not send a header that says otherwise.
      strictTransportSecurity: publicOrigin.startsWith('https:') ? 'max-age=31536000; includeSubDomains' : false,
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

  // CORS stays off (PLAN.md, «API-versjonering»): the browser calls the api from its own origin only. CSRF is checked per
  // route by the policy guard (middleware/policy.ts), because it depends on the route's policy and not on the path.
  app.use(authContext({ sessions: services.sessions, publicOrigin }))
  // Nothing under /auth or /me is cached by a browser or a proxy (security §3, §7). The guard adds the same header for
  // every route that needs a session, so an error response from either carries it too.
  const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  }
  app.use('/api/v1/auth/*', noStore)
  app.use('/api/v1/me', noStore)
  app.use('/api/v1/me/*', noStore)
  app.use('/api/v1/system/*', noStore)

  app.route('/api', createHealthApp({ pool: deps.pool, version: deps.version }))
  app.route('/api/v1', createAuthApp(services))
  app.route('/api/v1', createMeApp(services))
  app.route('/api/v1', createSecurityApp(services))
  app.route('/api/v1', createSystemApp(services))

  const document = { openapi: '3.1.0', info: { title: 'toascribe API', version: deps.version } } as const
  app.get(OPENAPI_PATH, policyGuard(publicAccess()), (c) =>
    c.json(annotatePolicies(app.getOpenAPI31Document(document))),
  )

  app.notFound(onNotFound)
  app.onError(onError)

  // A route registered without a policy would be open. Refuse to start rather than serve it (K-312, security §2).
  const unguarded = findUnguardedRoutes(app)
  if (unguarded.length > 0) {
    throw new Error(`routes without a policy: ${unguarded.join(', ')}`)
  }
  return { app, services }
}
