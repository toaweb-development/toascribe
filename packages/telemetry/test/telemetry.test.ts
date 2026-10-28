// K-298: what reaches the collector. A local OTLP/HTTP collector takes what the SDK sends; a span with secrets in its attributes,
// its address and an event arrives with the log's hidden fields hidden and the query dropped. The scrubber's rules on their own too.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { trace } from '@opentelemetry/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scrubAttribute, startTelemetry } from '../src/index.ts'

describe('scrubAttribute', () => {
  it('hides listed names by their last part, drops the query of an address and scrubs every string', () => {
    expect(scrubAttribute('http.request.header.cookie', 'sid=abc')).toBe('[skjult]')
    expect(scrubAttribute('app.password', 'x')).toBe('[skjult]')
    expect(scrubAttribute('url.full', 'https://blogg.example/api/v1/content?token=abc')).toBe(
      'https://blogg.example/api/v1/content?[skjult]',
    )
    expect(scrubAttribute('url.query', 'token=abc')).toBe('[skjult]')
    expect(scrubAttribute('db.query.text', "select * from account where email = 'ola@example.test'")).toBe(
      'select * from account where email = [skjult]'.replace('[skjult]', "'[skjult]'"),
    )
    expect(scrubAttribute('http.response.status_code', 200)).toBe(200)
    expect(scrubAttribute('url.path', '/api/v1/content')).toBe('/api/v1/content')
  })
})

describe('the SDK, with a collector on this machine', () => {
  const bodies: string[] = []
  let endpoint = ''
  const collector = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    request.on('end', () => {
      bodies.push(`${request.url ?? ''} ${body}`)
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })

  beforeAll(async () => {
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${String((collector.address() as AddressInfo).port)}`
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => collector.close(() => resolve()))
  })

  it('sends spans with the hidden fields hidden', async () => {
    const telemetry = startTelemetry({ endpoint, serviceName: 'toascribe-test', serviceVersion: '0.0.0' })
    const span = trace.getTracer('test').startSpan('request', {
      attributes: {
        'url.full': 'https://blogg.example/api/v1/content?token=hemmelig-1',
        'http.request.header.authorization': 'Basic hemmelig-2',
        'enduser.email': 'hemmelig@example.test',
        'app.note': 'mail til hemmelig@example.test',
      },
    })
    span.addEvent('exception', { 'exception.message': 'feil for hemmelig@example.test med Bearer hemmelig-3' })
    span.end()
    await telemetry.shutdown()
    const sent = bodies.filter((body) => body.startsWith('/v1/traces')).join('\n')
    expect(sent).toContain('toascribe-test')
    for (const secret of ['hemmelig-1', 'hemmelig-2', 'hemmelig-3', 'hemmelig@example.test'])
      expect(sent, secret).not.toContain(secret)
    expect(sent).toContain('[skjult]')
  })
})
