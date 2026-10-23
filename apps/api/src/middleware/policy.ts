import { createRoute } from '@hono/zod-openapi'
import type { RouteConfig } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { COMPOSED_HANDLER } from 'hono/utils/constants'
import { constantTimeEqual } from '@toascribe/auth'
import { SETUP_TOKEN_HEADER } from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { describePolicy } from '../lib/policy.ts'
import type { BodyType, Policy } from '../lib/policy.ts'
import { getClientIp } from '../lib/client-ip.ts'
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../lib/errors.ts'
import { currentAuth } from './auth.ts'

/** Methods that must not change anything; every other method is state-changing and gets the CSRF checks. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The guard of every route, found again by `findUnguardedRoutes` through this map. */
const POLICY_OF = new WeakMap<object, Policy>()

function isJsonContentType(value: string): boolean {
  return /^application\/json\s*(;.*)?$/i.test(value.trim())
}

function isMultipartContentType(value: string): boolean {
  return /^multipart\/form-data\s*;/i.test(value.trim())
}

/** True when the request says it has a body: a length above zero, or a chunked transfer. */
function hasBody(headers: { header: (name: string) => string | undefined }): boolean {
  const length = headers.header('content-length')
  return (length !== undefined && length !== '0') || headers.header('transfer-encoding') !== undefined
}

/**
 * Cross-site checks for a state-changing request (K-258, K-311, security §3). Hono's own `csrf()` only looks at form
 * content types and lets JSON through, so it is not enough, and `SameSite=Lax` is a second layer, not the defence.
 * 1. Where from: `Sec-Fetch-Site` must be `same-origin` when it is sent, and `Origin` must be our own origin when it is
 *    sent. At least one of them must be there: a request with neither is refused (fail closed).
 * 2. What: the body is JSON (or multipart on a route that says so). A cross-site form can send neither.
 */
function checkRequestOrigin(c: Parameters<MiddlewareHandler<AppEnv>>[0], bodyType: BodyType): void {
  const { publicOrigin } = c.get('security')
  const site = c.req.header('sec-fetch-site')
  const origin = c.req.header('origin')

  if (site !== undefined && site !== 'same-origin') {
    throw new BadRequestError('Cross-site request refused', 'origin_invalid')
  }
  if (origin !== undefined ? origin !== publicOrigin : site === undefined) {
    throw new BadRequestError('Cross-site request refused', 'origin_invalid')
  }

  const type = c.req.header('content-type')
  if (type === undefined) {
    if (hasBody(c.req)) {
      throw new BadRequestError('Send the body as application/json', 'unsupported_media_type')
    }
    return
  }
  if (!isJsonContentType(type) && !(bodyType === 'multipart' && isMultipartContentType(type))) {
    throw new BadRequestError('Send the body as application/json', 'unsupported_media_type')
  }
}

/**
 * The guard that runs before a route's validators and handler. For a public route it checks where a state-changing request
 * comes from. For the others it also finds the session (401 without one), checks the CSRF token, and then the capability (403).
 */
export function policyGuard(policy: Policy, bodyType: BodyType = 'json'): MiddlewareHandler<AppEnv> {
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    const stateChanging = !SAFE_METHODS.has(c.req.method)
    if (policy.kind !== 'public') {
      c.header('Cache-Control', 'no-store')
    }
    if (policy.kind === 'setup-token') {
      // The setup wizard's routes. Installed: they do not exist (404 before anything else is looked at, so the answer says
      // nothing about a token). Not installed: where-from checks, then the token. There is no session yet, so there is
      // no CSRF token either; the setup token takes its place. It is a secret in a header that a page on another site
      // cannot make the browser send (a cross-site form or a simple request cannot set a custom header, and a script
      // that does gets a preflight that the api, with no CORS, never allows), so it carries the same proof as the CSRF token.
      const { setupGate } = c.get('security')
      await setupGate.assertOpen()
      if (stateChanging) {
        checkRequestOrigin(c, bodyType)
      }
      await setupGate.authorize({ token: c.req.header(SETUP_TOKEN_HEADER), ip: getClientIp(c) })
      await next()
      return
    }
    if (stateChanging) {
      checkRequestOrigin(c, bodyType)
    }
    if (policy.kind === 'public') {
      await next()
      return
    }

    const auth = await currentAuth(c)
    if (auth.kind !== 'session') {
      throw new UnauthorizedError()
    }
    if (auth.mfa !== 'ok' && !(policy.kind === 'authenticated' && policy.allowPendingMfa === true)) {
      throw new UnauthorizedError('A second factor is required', 'mfa_required')
    }
    if (stateChanging && auth.via === 'cookie') {
      const sent = c.req.header('x-csrf-token')
      if (sent === undefined || !constantTimeEqual(sent, c.get('security').csrfTokenFor(auth.session.id))) {
        c.get('logger').warn(
          { path: c.req.path, accountId: auth.account.id },
          'request refused: CSRF token missing or wrong',
        )
        throw new ForbiddenError('CSRF token missing or invalid')
      }
    }
    if (policy.kind === 'capability' && !auth.capabilities.has(policy.capability)) {
      throw new ForbiddenError()
    }
    await next()
  }
  POLICY_OF.set(guard, policy)
  return guard
}

type RouteConfigWithPolicy<P extends string> = Omit<RouteConfig, 'path' | 'middleware'> & {
  readonly path: P
  /** Required: a route without it does not compile (K-312). */
  readonly policy: Policy
  /** Default `json`. `multipart` lets a route take file uploads. */
  readonly bodyType?: BodyType
}

/**
 * `createRoute` with a required `policy`. It puts the guard first in the route's middleware, so the policy, the origin
 * checks and the CSRF token are checked before the body is read or validated.
 */
export function defineRoute<P extends string, R extends RouteConfigWithPolicy<P>>(config: R) {
  // `policy` and `bodyType` stay on the config: the OpenAPI generator only reads the properties it knows.
  return createRoute({ ...config, middleware: [policyGuard(config.policy, config.bodyType)] })
}

/** The policy a handler carries, if it is a guard made by `policyGuard`. */
export function policyOfHandler(handler: unknown): Policy | undefined {
  if (typeof handler !== 'function') {
    return undefined
  }
  const direct = POLICY_OF.get(handler)
  if (direct !== undefined) {
    return direct
  }
  // A sub-app with its own error handler wraps its handlers; Hono keeps the original under this symbol.
  const inner: unknown = Reflect.get(handler, COMPOSED_HANDLER)
  return typeof inner === 'function' ? POLICY_OF.get(inner) : undefined
}

interface RouteLister {
  readonly routes: readonly { readonly method: string; readonly path: string; readonly handler: unknown }[]
}

/**
 * The routes of `app` that have no guard, as `METHOD /path`. A route is guarded when one of the handlers registered for
 * its method and path was made by `policyGuard`. Middleware registered with `app.use` (method ALL) is not a route.
 */
export function findUnguardedRoutes(app: RouteLister): string[] {
  const guarded = new Map<string, boolean>()
  for (const route of app.routes) {
    if (route.method === 'ALL') {
      continue
    }
    const key = `${route.method} ${route.path}`
    guarded.set(key, guarded.get(key) === true || policyOfHandler(route.handler) !== undefined)
  }
  return [...guarded].filter(([, isGuarded]) => !isGuarded).map(([key]) => key)
}

/** Every route with its policy, as `METHOD /path` -> text, for tests and for documentation. */
export function listRoutePolicies(app: RouteLister): Map<string, string> {
  const policies = new Map<string, string>()
  for (const route of app.routes) {
    const policy = route.method === 'ALL' ? undefined : policyOfHandler(route.handler)
    if (policy !== undefined) {
      policies.set(`${route.method} ${route.path}`, describePolicy(policy))
    }
  }
  return policies
}

const POLICY_KINDS = ['public', 'authenticated', 'capability', 'setup-token'] as const

/**
 * `defineRoute` leaves `policy` and `bodyType` on the route config, and the OpenAPI generator copies unknown keys into the
 * document. Moves them into one vendor extension, `x-policy` (`public`, `authenticated`, `capability:manage_options`), which
 * is useful to a reader of the document, and removes the originals. Returns the document it was given.
 */
export function annotatePolicies<T extends object>(document: T): T {
  const paths: unknown = Reflect.get(document, 'paths')
  if (typeof paths !== 'object' || paths === null) {
    return document
  }
  for (const pathKey of Object.keys(paths)) {
    const item: unknown = Reflect.get(paths, pathKey)
    if (typeof item !== 'object' || item === null) {
      continue
    }
    for (const method of Object.keys(item)) {
      const operation: unknown = Reflect.get(item, method)
      if (typeof operation !== 'object' || operation === null) {
        continue
      }
      const policy: unknown = Reflect.get(operation, 'policy')
      if (typeof policy === 'object' && policy !== null) {
        const kind: unknown = Reflect.get(policy, 'kind')
        const capability: unknown = Reflect.get(policy, 'capability')
        if (typeof kind === 'string' && POLICY_KINDS.some((known) => known === kind)) {
          Reflect.set(
            operation,
            'x-policy',
            kind === 'capability' && typeof capability === 'string' ? `capability:${capability}` : kind,
          )
        }
      }
      Reflect.deleteProperty(operation, 'policy')
      Reflect.deleteProperty(operation, 'bodyType')
    }
  }
  return document
}
