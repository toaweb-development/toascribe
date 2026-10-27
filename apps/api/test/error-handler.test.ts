// The single error handler (typescript §8): a unique violation from the database is a 409 wherever it comes from (two requests that
// make the same slug at once), with no constraint name in the answer; anything else unknown stays a 500.
import { Hono } from 'hono'
import pino from 'pino'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/lib/env.ts'
import { onError } from '../src/middleware/errors.ts'

function appThrowing(error: unknown) {
  const app = new Hono<AppEnv>()
  app.use(async (c, next) => {
    c.set('requestId', 'req-1')
    c.set('logger', pino({ level: 'silent' }))
    await next()
  })
  app.get('/', () => {
    throw error
  })
  app.onError(onError)
  return app
}

describe('onError', () => {
  it('answers a unique violation with 409, also when Drizzle wraps it, and names no constraint', async () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "global_set_slug_key"'), {
      code: '23505',
      constraint: 'global_set_slug_key',
    })
    for (const error of [pg, new Error('Failed query', { cause: pg })]) {
      const res = await appThrowing(error).request('/')
      expect(res.status).toBe(409)
      const body = await res.text()
      expect(body).toContain('conflict')
      expect(body).not.toContain('global_set_slug_key')
    }
  })

  it('keeps another database error a 500', async () => {
    const res = await appThrowing(Object.assign(new Error('deadlock'), { code: '40P01' })).request('/')
    expect(res.status).toBe(500)
  })
})
