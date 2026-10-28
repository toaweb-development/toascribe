// K-298 in the real process: started with OTEL_EXPORTER_OTLP_ENDPOINT, the api (src/index.ts, no Node flag) registers the ESM hook
// before it loads the app, so its incoming requests become spans that reach a collector on this machine, scrubbed (no query, no
// secret). Started without it, nothing reaches the collector. No database is needed (/api/v1/openapi.json does not query).
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function processEnv(extra: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return {
    ...base,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://app:sekret-pw-123@127.0.0.1:1/toascribe',
    PUBLIC_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'warn',
    TOASCRIBE_ENCRYPTION_KEY: 'ab'.repeat(16) + 'cd'.repeat(16),
    TOASCRIBE_SIGNING_KEY: '12'.repeat(16) + '34'.repeat(16),
    ...extra,
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function run(env: Record<string, string>, port: number): Promise<void> {
  const child: ChildProcess = spawn(process.execPath, ['--conditions=source', ENTRY], { env, stdio: 'ignore' })
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/openapi.json?token=hemmelig-query`)
      if (res.ok) break
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('the api did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill('SIGTERM') // the clean shutdown flushes the spans
  await exited
}

describe('OpenTelemetry in the api process', () => {
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

  it('sends nothing without OTEL_EXPORTER_OTLP_ENDPOINT', async () => {
    const port = await freePort()
    await run(processEnv({ PORT: String(port) }), port)
    expect(bodies).toEqual([])
  }, 30_000)

  it('sends the request as a span, without its query, when the endpoint is set', async () => {
    const port = await freePort()
    await run(processEnv({ PORT: String(port), OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }), port)
    const traces = bodies.filter((body) => body.startsWith('/v1/traces')).join('\n')
    expect(traces).toContain('toascribe-api')
    expect(traces).toContain('/api/v1/openapi.json')
    expect(traces).not.toContain('hemmelig-query')
    expect(traces).not.toContain('sekret-pw-123')
  }, 30_000)
})
