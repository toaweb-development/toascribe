// K-252: a route on its way out says so on every answer (Deprecation as RFC 9745's `@<seconds>`, Sunset as an HTTP date, Link to
// the rule and to the route to use instead), errors included, and the OpenAPI document marks it deprecated with its sunset day.
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/lib/env.ts'
import { publicAccess } from '../src/lib/policy.ts'
import { annotatePolicies, defineRoute } from '../src/middleware/policy.ts'

const retiring = defineRoute({
  method: 'get',
  path: '/old',
  policy: publicAccess(),
  retiring: { since: '2026-11-01', sunset: '2027-05-01', successor: '/api/v1/new' },
  request: { query: z.object({ n: z.coerce.number().int().optional() }) },
  responses: { 200: { description: 'ok' }, 400: { description: 'bad' } },
})
const current = defineRoute({
  method: 'get',
  path: '/new',
  policy: publicAccess(),
  responses: { 200: { description: 'ok' } },
})

function app() {
  return new OpenAPIHono<AppEnv>().openapi(retiring, (c) => c.text('old')).openapi(current, (c) => c.text('new'))
}

describe('a retiring route', () => {
  it('says so in every answer, an error too, and a current route says nothing', async () => {
    for (const path of ['/old', '/old?n=x']) {
      const res = await app().request(path)
      expect(res.headers.get('deprecation')).toBe(`@${String(Date.UTC(2026, 10, 1) / 1000)}`)
      expect(res.headers.get('sunset')).toBe('Sat, 01 May 2027 00:00:00 GMT')
      expect(res.headers.get('link')).toContain('rel="deprecation"')
      expect(res.headers.get('link')).toContain('</api/v1/new>; rel="successor-version"')
    }
    const now = await app().request('/new')
    expect(now.headers.get('deprecation')).toBeNull()
    expect(now.headers.get('sunset')).toBeNull()
  })

  it('is marked deprecated in the OpenAPI document, with its sunset day', () => {
    const document = annotatePolicies(
      app().getOpenAPI31Document({ openapi: '3.1.0', info: { title: 't', version: '1' } }),
    )
    const operation = document.paths?.['/old']?.get as Record<string, unknown> | undefined
    expect(operation?.['deprecated']).toBe(true)
    expect(operation?.['x-sunset']).toBe('2027-05-01')
    expect(operation?.['retiring']).toBeUndefined()
  })
})
