// K-297: the api's real logger, with its real request middleware, hides every field of the fixed list, wherever a careless line puts
// it, and every e-mail address and credential in a string. A request that carries them all (headers, query, body) is logged by a
// route that logs everything it got: nothing of it reaches the log. The request id the site sends follows the request into its log
// lines, its answer and the jobs it queues; TOASCRIBE_DEBUG=1 names the kind of a 500, never its message or stack.
import { currentRequestId, runWithRequestId, takeRequestId, withRequestId } from '@toascribe/db'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { describe, expect, it } from 'vitest'

import type { AppEnv } from '../src/lib/env.ts'
import { createLogger } from '../src/lib/logger.ts'
import { onError } from '../src/middleware/errors.ts'
import { requestLogger } from '../src/middleware/request-logger.ts'

const SECRETS = {
  password: 'hemmelig-passord-1',
  token: 'hemmelig-token-2',
  secret: 'hemmelig-secret-3',
  cookie: 'sid=hemmelig-cookie-4',
  authorization: 'Bearer hemmelig-bearer-5',
  email: 'hemmelig.adresse@example.test',
}

function captured() {
  const lines: string[] = []
  const logger = createLogger({ level: 'debug', pretty: false, destination: { write: (line) => lines.push(line) } })
  return { lines, logger }
}

function app(logger: ReturnType<typeof createLogger>, debug = false) {
  const hono = new Hono<AppEnv>()
  hono.use(requestId({ limitLength: 128 }))
  hono.use(requestLogger(logger))
  hono.use(async (c, next) => {
    c.set('debug', debug)
    await runWithRequestId(c.get('requestId'), next)
  })
  hono.post('/careless', async (c) => {
    // Everything the request had, logged as a careless route would.
    c.get('logger').info(
      {
        headers: Object.fromEntries(c.req.raw.headers),
        query: c.req.query(),
        body: await c.req.json<unknown>(),
        nested: { deeper: { user: { email: SECRETS.email, apiKey: 'hemmelig-nokkel-6' } } },
        err: new Error(`could not mail ${SECRETS.email} with ${SECRETS.authorization}`),
      },
      `failed for ${SECRETS.email}`,
    )
    return c.json({ queued: withRequestId({ kind: 'job' }) })
  })
  hono.get('/boom', () => {
    throw Object.assign(new Error(`select failed for ${SECRETS.email}`), { code: '40P01' })
  })
  hono.onError(onError)
  return hono
}

describe('the api log', () => {
  it('keeps every hidden field, address and credential out of a careless line about a request that has them all', async () => {
    const { lines, logger } = captured()
    const res = await app(logger).request(
      `/careless?token=${SECRETS.token}&email=${encodeURIComponent(SECRETS.email)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: SECRETS.authorization,
          cookie: SECRETS.cookie,
          'x-csrf-token': 'hemmelig-csrf-7',
        },
        body: JSON.stringify({ ...SECRETS, profile: { newPassword: 'hemmelig-ny-8', to: SECRETS.email } }),
      },
    )
    expect(res.status).toBe(200)
    const log = lines.join('')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const value of [
      ...Object.values(SECRETS),
      'hemmelig-nokkel-6',
      'hemmelig-csrf-7',
      'hemmelig-ny-8',
      'hemmelig-bearer-5',
    ]) {
      expect(log, value).not.toContain(value)
    }
    expect(log).toContain('[skjult]')
  })

  it('carries the request id the site sent into the log, the answer and a queued job; a bad one is replaced', async () => {
    const { lines, logger } = captured()
    const res = await app(logger).request('/careless', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'side-1234_abc' },
      body: '{}',
    })
    expect(res.headers.get('x-request-id')).toBe('side-1234_abc')
    expect(await res.json()).toEqual({ queued: { kind: 'job', requestId: 'side-1234_abc' } })
    expect(lines.every((line) => line.includes('"requestId":"side-1234_abc"'))).toBe(true)

    const bad = await app(logger).request('/careless', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'bad id; drop' },
      body: '{}',
    })
    expect(bad.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('takes the request id out of a job before the job is read, and drops one that is not an id', () => {
    expect(takeRequestId({ kind: 'job', requestId: 'abc-1' })).toEqual({ requestId: 'abc-1', data: { kind: 'job' } })
    expect(takeRequestId({ kind: 'job', requestId: 'not an id!' })).toEqual({
      requestId: undefined,
      data: { kind: 'job' },
    })
    expect(takeRequestId({ kind: 'job' })).toEqual({ requestId: undefined, data: { kind: 'job' } })
    expect(currentRequestId()).toBeUndefined()
    expect(withRequestId({ kind: 'job' })).toEqual({ kind: 'job' })
  })

  it('says the kind of a 500 only with TOASCRIBE_DEBUG=1, and never its message or stack', async () => {
    const { logger } = captured()
    const quiet = (await (await app(logger).request('/boom')).json()) as { error: Record<string, unknown> }
    expect(quiet.error['debug']).toBeUndefined()
    const loud = await (await app(logger, true).request('/boom')).text()
    expect(JSON.parse(loud)).toMatchObject({
      error: { code: 'internal_error', debug: { kind: 'Error', code: '40P01' } },
    })
    expect(loud).not.toContain('select failed')
    expect(loud).not.toContain('example.test')
    expect(loud).not.toContain('at ')
  })
})
