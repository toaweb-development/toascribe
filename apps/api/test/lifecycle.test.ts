// The real process: start `src/index.ts`, probe it, send SIGTERM. No database is needed, because the
// pool connects lazily and /api/health never queries.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const HEALTHCHECK = fileURLToPath(new URL('../src/healthcheck.ts', import.meta.url))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

function envFor(port: number): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return {
    ...base,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: 'postgres://app:sekret-pw-123@127.0.0.1:1/toascribe',
    PUBLIC_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
  }
}

interface Running {
  readonly child: ChildProcess
  readonly output: () => string
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function start(env: Record<string, string>): Running {
  const child = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal })
    })
  })
  return { child, output: () => out, exited }
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function healthcheck(env: Record<string, string>): number | null {
  return spawnSync(process.execPath, [HEALTHCHECK], { env, encoding: 'utf8' }).status
}

let running: Running | undefined
afterEach(() => {
  running?.child.kill('SIGKILL')
  running = undefined
})

describe('the api process', () => {
  it('serves, passes its healthcheck, and exits 0 on SIGTERM', async () => {
    const port = await freePort()
    const env = envFor(port)
    running = start(env)
    await waitFor(() => running?.output().includes('api listening') === true, 'the server to listen')

    const res = await fetch(`http://127.0.0.1:${String(port)}/api/health`)
    expect(res.status).toBe(200)
    expect(healthcheck(env)).toBe(0)

    running.child.kill('SIGTERM')
    const { code } = await running.exited
    expect(code).toBe(0)
    expect(running.output()).toContain('shutdown complete')
    expect(running.output()).not.toContain('sekret')

    // Down now: the healthcheck must fail.
    expect(healthcheck(env)).not.toBe(0)
  })

  it('exits 0 on SIGINT too', async () => {
    const port = await freePort()
    running = start(envFor(port))
    await waitFor(() => running?.output().includes('api listening') === true, 'the server to listen')
    running.child.kill('SIGINT')
    expect((await running.exited).code).toBe(0)
  })

  it('refuses to start with a bad environment, naming the variable and never the value', async () => {
    const env = { ...envFor(await freePort()), DATABASE_URL: 'not-a-url-sekret' }
    running = start(env)
    const { code } = await running.exited
    expect(code).toBe(1)
    expect(running.output()).toContain('DATABASE_URL')
    expect(running.output()).not.toContain('sekret')
  })

  it('logs JSON with the request id on each request line', async () => {
    const port = await freePort()
    running = start({ ...envFor(port), LOG_LEVEL: 'debug' })
    await waitFor(() => running?.output().includes('api listening') === true, 'the server to listen')
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/nope`, { headers: { 'x-request-id': 'life-1' } })
    expect(res.status).toBe(404)
    await waitFor(() => running?.output().includes('life-1') === true, 'the request log line')
    const line = running
      .output()
      .split('\n')
      .find((l) => l.includes('life-1'))
    expect(JSON.parse(line ?? '{}')).toMatchObject({ requestId: 'life-1', status: 404, path: '/api/nope' })
  })
})
