// K-312: the api refuses to start when a route has no policy. Proved here with a health route that is registered the old
// way (a plain `app.get`), which is what a careless new route would look like.
import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, it, vi } from 'vitest'

import type { AppEnv } from '../src/lib/env.ts'
import { UNREACHABLE_DATABASE_URL, makeApp } from './helpers.ts'

vi.mock('../src/routes/health.ts', () => ({
  createHealthApp: () => {
    const app = new OpenAPIHono<AppEnv>()
    app.get('/oops', (c) => c.text('open to everyone'))
    app.post('/oops-too', (c) => c.text('open to everyone'))
    return app
  },
}))

describe('start-up', () => {
  it('throws, naming the routes, when the app has a route without a policy', () => {
    expect(() => makeApp(UNREACHABLE_DATABASE_URL)).toThrow(
      'routes without a policy: GET /api/oops, POST /api/oops-too',
    )
  })
})
