import { OpenAPIHono } from '@hono/zod-openapi'
import { HealthResponse, ReadyResponse } from '@toascribe/shared'

import type { AppEnv } from '../lib/env.ts'
import { publicAccess } from '../lib/policy.ts'
import { defineRoute } from '../middleware/policy.ts'
import type { Pool } from '../repositories/health.ts'
import { checkReadiness } from '../services/health.ts'

export interface HealthDeps {
  readonly pool: Pool
  readonly version: string
}

const healthRoute = defineRoute({
  method: 'get',
  path: '/health',
  policy: publicAccess(), // the container healthcheck and the proxy call it without a session
  tags: ['system'],
  summary: 'Liveness: the process is up',
  description: 'Does not touch the database. Used by the container healthcheck.',
  responses: {
    200: { content: { 'application/json': { schema: HealthResponse } }, description: 'The API is running' },
  },
})

const readyRoute = defineRoute({
  method: 'get',
  path: '/ready',
  policy: publicAccess(),
  tags: ['system'],
  summary: 'Readiness: the database answers',
  responses: {
    200: { content: { 'application/json': { schema: ReadyResponse } }, description: 'Ready to serve requests' },
    503: { content: { 'application/json': { schema: ReadyResponse } }, description: 'A dependency is unavailable' },
  },
})

/** Public routes (no auth, by design). Mounted under /api by createApp. */
export function createHealthApp(deps: HealthDeps) {
  return new OpenAPIHono<AppEnv>()
    .openapi(healthRoute, (c) => c.json({ status: 'ok' as const, version: deps.version }, 200))
    .openapi(readyRoute, async (c) => {
      const result = await checkReadiness(deps.pool, c.get('logger'))
      return result.status === 'ok' ? c.json(result, 200) : c.json(result, 503)
    })
}
