import { createRoute, z } from '@hono/zod-openapi'
import { ApiError, HealthResponse, ReadyResponse } from '@toascribe/shared'
import { afterEach, describe, expect, it } from 'vitest'

import { ConflictError, NotFoundError } from '../src/lib/errors.ts'
import { TEST_DATABASE_URL, UNREACHABLE_DATABASE_URL, makeApp, noticeIfSkipped } from './helpers.ts'

noticeIfSkipped('api')

const OpenApiDoc = z.object({
  openapi: z.string(),
  info: z.object({ version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
})

const pools: { end: () => Promise<void> }[] = []
function app(connectionString = UNREACHABLE_DATABASE_URL, version?: string) {
  const made = makeApp(connectionString, version)
  pools.push(made.pool)
  return made
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

describe('GET /api/health', () => {
  it('answers 200 with the version and does not touch the database', async () => {
    const { app: a } = app(UNREACHABLE_DATABASE_URL, '1.2.3')
    const res = await a.request('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(HealthResponse.parse(await res.json())).toEqual({ status: 'ok', version: '1.2.3' })
  })

  it('answers HEAD from the GET route', async () => {
    const { app: a } = app()
    const res = await a.request('/api/health', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})

describe('GET /api/ready', () => {
  it('answers 503 when the database is unreachable, and leaks no error text', async () => {
    const { app: a, lines } = app()
    const res = await a.request('/api/ready')
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(ReadyResponse.parse(JSON.parse(text))).toEqual({ status: 'unavailable', checks: { database: 'error' } })
    for (const leak of ['ECONNREFUSED', '127.0.0.1', 'sekret', 'postgres://', 'connect']) {
      expect(text).not.toContain(leak)
    }
    // The cause is logged, not returned.
    const warning = lines.find((line) => line['msg'] === 'readiness check failed: database')
    expect(warning).toBeDefined()
    expect(JSON.stringify(warning)).toContain('ECONNREFUSED')
    expect(JSON.stringify(lines)).not.toContain('sekret')
  })

  it.skipIf(TEST_DATABASE_URL === undefined)(
    'answers 200 with a reachable database (needs TEST_DATABASE_URL)',
    async () => {
      const { app: a } = app(TEST_DATABASE_URL ?? UNREACHABLE_DATABASE_URL)
      const res = await a.request('/api/ready')
      expect(res.status).toBe(200)
      expect(ReadyResponse.parse(await res.json())).toEqual({ status: 'ok', checks: { database: 'ok' } })
    },
  )
})

describe('GET /api/v1/openapi.json', () => {
  it('is a valid OpenAPI 3.1 document that lists health and ready', async () => {
    const { app: a } = app(UNREACHABLE_DATABASE_URL, '4.5.6')
    const res = await a.request('/api/v1/openapi.json')
    expect(res.status).toBe(200)
    const doc = OpenApiDoc.parse(await res.json())
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.version).toBe('4.5.6')
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/health', '/api/ready']))
    expect(JSON.stringify(doc.paths['/api/ready'])).toContain('503')
  })
})

describe('errors', () => {
  it('answers an unknown route with a 404 ApiError carrying the request id', async () => {
    const { app: a } = app()
    const res = await a.request('/api/nope')
    expect(res.status).toBe(404)
    const body = ApiError.parse(await res.json())
    expect(body.error.code).toBe('not_found')
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'))
  })

  it('maps typed errors to their status and code', async () => {
    const { app: a } = app()
    a.get('/api/test/missing', () => {
      throw new NotFoundError('No such post')
    })
    a.get('/api/test/conflict', () => {
      throw new ConflictError()
    })
    const missing = await a.request('/api/test/missing')
    expect(missing.status).toBe(404)
    expect(ApiError.parse(await missing.json()).error).toMatchObject({ code: 'not_found', message: 'No such post' })
    const conflict = await a.request('/api/test/conflict')
    expect(conflict.status).toBe(409)
    expect(ApiError.parse(await conflict.json()).error.code).toBe('conflict')
  })

  it('answers an unexpected error with a generic 500 and logs the stack only', async () => {
    const { app: a, lines } = app()
    a.get('/api/test/boom', () => {
      throw new Error('relation "users" does not exist at /srv/secret/path.ts')
    })
    const res = await a.request('/api/test/boom')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(ApiError.parse(JSON.parse(text)).error).toMatchObject({
      code: 'internal_error',
      message: 'Internal server error',
    })
    expect(text).not.toContain('users')
    expect(text).not.toContain('/srv/secret')
    const logged = lines.find((line) => line['msg'] === 'unhandled error')
    expect(JSON.stringify(logged)).toContain('relation \\"users\\" does not exist')
    expect(JSON.stringify(logged)).toContain('stack')
    expect(logged?.['requestId']).toBe(res.headers.get('x-request-id'))
  })

  it('answers a failed validation with an ApiError, not the library default', async () => {
    const { app: a } = app()
    const route = createRoute({
      method: 'get',
      path: '/api/test/page',
      request: { query: z.object({ page: z.coerce.number().int().min(1) }) },
      responses: {
        200: { content: { 'application/json': { schema: z.object({ page: z.number() }) } }, description: 'ok' },
      },
    })
    a.openapi(route, (c) => c.json({ page: c.req.valid('query').page }, 200))
    expect((await a.request('/api/test/page?page=2')).status).toBe(200)
    const res = await a.request('/api/test/page?page=abc')
    expect(res.status).toBe(400)
    const body = ApiError.parse(await res.json())
    expect(body.error).toMatchObject({ code: 'validation_error', message: 'Invalid request: page' })
  })

  it('refuses a body over the limit with a 413 ApiError', async () => {
    const { app: a } = app()
    const res = await a.request('/api/nope', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) })
    expect(res.status).toBe(413)
    expect(ApiError.parse(await res.json()).error.code).toBe('payload_too_large')
  })
})

describe('middleware', () => {
  it('sets security headers', async () => {
    const { app: a } = app()
    const res = await a.request('/api/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  it('puts the request id on the response and on every log line of the request', async () => {
    const { app: a, lines } = app()
    const res = await a.request('/api/nope', { headers: { 'x-request-id': 'req-abc-123' } })
    expect(res.headers.get('x-request-id')).toBe('req-abc-123')
    const mine = lines.filter((line) => line['requestId'] === 'req-abc-123')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.find((line) => line['msg'] === 'request rejected')).toMatchObject({
      method: 'GET',
      path: '/api/nope',
      status: 404,
    })
  })

  it('generates a request id when none is sent, and logs no query string', async () => {
    const { app: a, lines } = app()
    const res = await a.request('/api/health?token=hunter2')
    const id = res.headers.get('x-request-id')
    expect(id).toBeTruthy()
    expect(JSON.stringify(lines)).not.toContain('hunter2')
    expect(lines.some((line) => line['requestId'] === id)).toBe(true)
  })
})
