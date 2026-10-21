// K-312: every route declares a policy, and a route that does not is found. Nothing here needs a database: a request without
// a cookie never looks up a session.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiError } from '@toascribe/shared'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/lib/env.ts'
import { publicAccess, requireCapability } from '../src/lib/policy.ts'
import { defineRoute, findUnguardedRoutes, listRoutePolicies } from '../src/middleware/policy.ts'
import { UNREACHABLE_DATABASE_URL, makeApp } from './helpers.ts'
import { EXPECTED_POLICIES } from './policies.ts'

describe('route policies', () => {
  it('every route of the app has a policy, and the list is the expected one', () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    expect(findUnguardedRoutes(app)).toEqual([])
    expect(Object.fromEntries(listRoutePolicies(app))).toEqual(EXPECTED_POLICIES)
  })

  it('finds a route added without a policy, however it was added (and passes once it has one)', () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    expect(findUnguardedRoutes(app)).toEqual([])

    // 1. A plain Hono handler.
    app.get('/api/v1/oops', (c) => c.text('open'))
    // 2. A zod-openapi route made with createRoute, not defineRoute.
    const bare = createRoute({
      method: 'post',
      path: '/api/v1/bare',
      responses: { 200: { content: { 'application/json': { schema: z.object({}) } }, description: 'ok' } },
    })
    app.openapi(bare, (c) => c.json({}, 200))
    // 3. A sub-app mounted with app.route.
    app.route(
      '/api/v1/sub',
      new Hono().delete('/thing/:id', (c) => c.text('open')),
    )
    // 4. Middleware registered with app.use is not a route and is not reported.
    app.use('/api/v1/*', async (_c, next) => {
      await next()
    })

    expect(findUnguardedRoutes(app).sort()).toEqual([
      'DELETE /api/v1/sub/thing/:id',
      'GET /api/v1/oops',
      'POST /api/v1/bare',
    ])
  })

  it('a route that has a guard for one method does not cover another method on the same path', () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const guarded = defineRoute({
      method: 'get',
      path: '/api/v1/both',
      policy: publicAccess(),
      responses: { 200: { content: { 'application/json': { schema: z.object({}) } }, description: 'ok' } },
    })
    app.openapi(guarded, (c) => c.json({}, 200))
    app.post('/api/v1/both', (c) => c.text('open'))
    expect(findUnguardedRoutes(app)).toEqual(['POST /api/v1/both'])
  })

  it('a route made with defineRoute needs a policy to compile', () => {
    // @ts-expect-error -- `policy` is required: this line must not type-check without it
    const withoutPolicy = defineRoute({
      method: 'get',
      path: '/api/v1/no-policy',
      responses: { 200: { content: { 'application/json': { schema: z.object({}) } }, description: 'ok' } },
    })
    expect(withoutPolicy.method).toBe('get')
    // At run time the missing policy fails closed: the guard is not made, so the route is reported.
    const app = new OpenAPIHono<AppEnv>()
    app.openapi(withoutPolicy, (c) => c.json({}, 200))
    expect(findUnguardedRoutes(app)).toEqual(['GET /api/v1/no-policy'])
  })
})

describe('the guard without a database', () => {
  it('answers 401 to a protected route without a session, in the common error format', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    for (const [method, path] of [
      ['GET', '/api/v1/me'],
      ['PATCH', '/api/v1/me'],
      ['GET', '/api/v1/me/sessions'],
      ['DELETE', '/api/v1/me/sessions'],
      ['DELETE', '/api/v1/me/sessions/0198a3c2-0000-7000-8000-000000000000'],
      ['POST', '/api/v1/auth/logout'],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { origin: 'https://cms.example.test', 'content-type': 'application/json' },
        ...(method === 'PATCH' ? { body: '{"firstName":"A"}' } : {}),
      })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(ApiError.parse(await res.json()).error.code).toBe('unauthorized')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('a test route with capability policy refuses without a session and names its policy in the list', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    const route = defineRoute({
      method: 'get',
      path: '/api/v1/test/admin-only',
      policy: requireCapability('manage_options'),
      responses: { 200: { content: { 'application/json': { schema: z.object({}) } }, description: 'ok' } },
    })
    app.openapi(route, (c) => c.json({}, 200))
    expect((await app.request('/api/v1/test/admin-only')).status).toBe(401)
    expect(listRoutePolicies(app).get('GET /api/v1/test/admin-only')).toBe('capability:manage_options')
  })

  it('lets a public route through without any session', async () => {
    const { app } = makeApp(UNREACHABLE_DATABASE_URL)
    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/v1/openapi.json')).status).toBe(200)
    const session = await app.request('/api/v1/auth/session')
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({ status: 'anonymous' })
    expect(session.headers.get('cache-control')).toBe('no-store')
  })
})
