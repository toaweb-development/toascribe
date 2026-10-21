// The SSRF client against real sockets: local servers stand in for «the public internet» and a stub resolver stands in for
// DNS, so nothing leaves the machine. The default client (the one the package exports) is also used, for the cases that
// must be refused before any connection is made.
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SafeFetchError, createLookup, createSafeFetch } from '../src/safe-fetch.ts'
import type { ResolvedAddress, SafeFetchErrorCode } from '../src/safe-fetch.ts'
import { safeFetch } from '../src/index.ts'

interface TestServer {
  readonly port: number
  readonly connections: () => number
  readonly requests: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[]
  readonly close: () => Promise<void>
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

async function startServer(handler: Handler): Promise<TestServer> {
  let connections = 0
  const requests: TestServer['requests'] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      handler(req, res)
    })
  })
  server.on('connection', () => {
    connections += 1
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('the test server has no port')
  }
  return {
    port: address.port,
    connections: () => connections,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
}

/** Names the stub resolver knows. Everything else does not resolve. */
const NAMES: Record<string, readonly ResolvedAddress[]> = {
  'public.test': [{ address: '127.0.0.1', family: 4 }], // «public» only because the test client allows 127.0.0.1
  'internal.test': [{ address: '10.0.0.5', family: 4 }],
  'metadata.test': [{ address: '169.254.169.254', family: 4 }],
  'mixed.test': [
    { address: '127.0.0.1', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ],
  'mapped.test': [{ address: '::ffff:10.0.0.5', family: 6 }],
  'empty.test': [],
}

function stubResolve(hostname: string): Promise<readonly ResolvedAddress[]> {
  const found = NAMES[hostname]
  return found === undefined
    ? Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
    : Promise.resolve(found)
}

/** A client for the tests: names come from the stub, and 127.0.0.1 counts as public (and nothing else that is not). */
const testClient = createSafeFetch({
  resolve: stubResolve,
  isAllowed: (address) => address === '127.0.0.1',
})

async function codeOf(promise: Promise<unknown>): Promise<SafeFetchErrorCode | 'resolved'> {
  try {
    await promise
    return 'resolved'
  } catch (err) {
    if (err instanceof SafeFetchError) {
      return err.code
    }
    throw err
  }
}

const servers: TestServer[] = []
async function serve(handler: Handler): Promise<TestServer> {
  const server = await startServer(handler)
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

afterAll(async () => {
  await Promise.all([testClient.close(), safeFetch.close()])
})

const ok: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('hello')
}

describe('refuses before any connection is made (the default client)', () => {
  let bait: TestServer

  beforeAll(async () => {
    bait = await startServer(ok)
  })
  afterAll(async () => {
    await bait.close()
  })

  // Each of these would reach `bait` (127.0.0.1) if the address check were missing. The port is allowed on purpose, so the
  // refusal can only come from the address.
  it.each([
    ['an IPv4 loopback literal', (port: number) => `http://127.0.0.1:${String(port)}/`],
    ['a decimal IPv4 literal', (port: number) => `http://2130706433:${String(port)}/`],
    ['a hex IPv4 literal', (port: number) => `http://0x7f.1:${String(port)}/`],
    ['a short IPv4 literal', (port: number) => `http://127.1:${String(port)}/`],
    ['an IPv4-mapped IPv6 literal', (port: number) => `http://[::ffff:127.0.0.1]:${String(port)}/`],
    ['an IPv6 loopback literal', (port: number) => `http://[::1]:${String(port)}/`],
    ['the unspecified address', (port: number) => `http://0.0.0.0:${String(port)}/`],
    ['localhost', (port: number) => `http://localhost:${String(port)}/`],
    ['localhost with a dot', (port: number) => `http://localhost.:${String(port)}/`],
    ['a name under .localhost', (port: number) => `http://anything.localhost:${String(port)}/`],
  ])('%s', async (_name, url) => {
    const before = bait.connections()
    expect(await codeOf(safeFetch(url(bait.port), { allowedPorts: [bait.port] }))).toBe('blocked_address')
    expect(bait.connections()).toBe(before)
  })

  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.5.5/',
    'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254 in IPv4-mapped form
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://0.0.0.0/',
    'https://127.0.0.1/',
    'https://[::1]/',
  ])('refuses %s on the default ports', async (url) => {
    expect(await codeOf(safeFetch(url))).toBe('blocked_address')
  })

  it.each([
    ['ftp://example.com/file', 'blocked_scheme'],
    ['file:///etc/passwd', 'blocked_scheme'],
    ['gopher://example.com/', 'blocked_scheme'],
    ['javascript:alert(1)', 'blocked_scheme'],
    ['data:text/plain,hello', 'blocked_scheme'],
    ['ws://example.com/', 'blocked_scheme'],
    ['http://user:secret@example.com/', 'blocked_credentials'],
    ['http://example.com:22/', 'blocked_port'],
    ['http://example.com:8080/', 'blocked_port'],
    ['https://example.com:6379/', 'blocked_port'],
    ['not a url', 'invalid_url'],
    ['', 'invalid_url'],
    [`http://example.com/${'a'.repeat(3000)}`, 'invalid_url'],
  ] as const)('refuses %s (%s)', async (url, code) => {
    expect(await codeOf(safeFetch(url))).toBe(code)
  })

  it('does not put an address or a secret in the message', async () => {
    const err = await safeFetch('http://user:hunter2@10.0.0.1:99/').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const message = err instanceof Error ? err.message : ''
    expect(message).not.toContain('hunter2')
    expect(message).not.toContain('10.0.0.1')
  })
})

describe('createLookup', () => {
  interface Result {
    err: NodeJS.ErrnoException | null
    address: unknown
    family: number | undefined
  }

  function run(
    lookup: ReturnType<typeof createLookup>,
    hostname: string,
    options: Parameters<ReturnType<typeof createLookup>>[1],
  ): Promise<Result> {
    return new Promise((resolve) => {
      lookup(hostname, options, (err, address, family) => {
        resolve({ err, address, family })
      })
    })
  }

  const publicLookup = createLookup({
    resolve: (hostname) =>
      Promise.resolve(
        hostname === 'both.test'
          ? [
              { address: '8.8.8.8', family: 4 },
              { address: '2001:4860:4860::8888', family: 6 },
            ]
          : hostname === 'mixed.test'
            ? [
                { address: '8.8.8.8', family: 4 },
                { address: '10.0.0.5', family: 4 },
              ]
            : hostname === 'v6private.test'
              ? [{ address: 'fd00::1', family: 6 }]
              : hostname === 'mapped.test'
                ? [{ address: '::ffff:127.0.0.1', family: 6 }]
                : [{ address: '8.8.8.8', family: 4 }],
      ),
  })

  it('gives the checked addresses, all of them, when asked for all (undici asks on Node 24)', async () => {
    const result = await run(publicLookup, 'both.test', { all: true })
    expect(result.err).toBeNull()
    expect(result.address).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ])
  })

  it('gives one address and its family when not asked for all', async () => {
    const result = await run(publicLookup, 'one.test', {})
    expect(result).toEqual({ err: null, address: '8.8.8.8', family: 4 })
  })

  it('honours the family it is asked for', async () => {
    expect((await run(publicLookup, 'both.test', { all: true, family: 6 })).address).toEqual([
      { address: '2001:4860:4860::8888', family: 6 },
    ])
    expect((await run(publicLookup, 'both.test', { family: 4 })).address).toBe('8.8.8.8')
  })

  it.each(['mixed.test', 'v6private.test', 'mapped.test'])(
    'refuses %s: one private address spoils the answer',
    async (name) => {
      const result = await run(publicLookup, name, { all: true })
      expect(result.err?.code).toBe('EBLOCKED')
      const single = await run(publicLookup, name, {})
      expect(single.err?.code).toBe('EBLOCKED')
    },
  )

  it('passes a resolver failure on', async () => {
    const failing = createLookup({
      resolve: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })),
    })
    expect((await run(failing, 'gone.test', {})).err?.code).toBe('ENOTFOUND')
  })
})

describe('a name that resolves to a private address', () => {
  it('is refused, and nothing is connected to', async () => {
    for (const name of ['internal.test', 'metadata.test', 'mapped.test']) {
      expect(await codeOf(testClient(`http://${name}/`))).toBe('blocked_address')
    }
  })

  it('is refused when only one of several addresses is private', async () => {
    const target = await serve(ok)
    expect(await codeOf(testClient(`http://mixed.test:${String(target.port)}/`, { allowedPorts: [target.port] }))).toBe(
      'blocked_address',
    )
    expect(target.connections()).toBe(0)
  })

  it('fails with a network error when the name does not resolve', async () => {
    expect(await codeOf(testClient('http://nowhere.test/'))).toBe('network')
    expect(await codeOf(testClient('http://empty.test/'))).toBe('network')
  })
})

describe('a request to an allowed address', () => {
  it('connects through the checked lookup and returns the answer', async () => {
    const target = await serve(ok)
    const res = await testClient(`http://public.test:${String(target.port)}/path?q=1`, { allowedPorts: [target.port] })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('hello')
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.redirected).toBe(false)
    expect(target.requests[0]?.url).toBe('/path?q=1')
    // The Host header is the name, so virtual hosts work; the socket went to the address the lookup gave.
    expect(target.requests[0]?.headers.host).toBe(`public.test:${String(target.port)}`)
  })

  it('sends a method, headers and a body', async () => {
    const target = await serve(ok)
    await testClient(`http://public.test:${String(target.port)}/hook`, {
      allowedPorts: [target.port],
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': 'yes' },
      body: '{"a":1}',
    })
    expect(target.requests[0]).toMatchObject({ method: 'POST', body: '{"a":1}' })
    expect(target.requests[0]?.headers['x-test']).toBe('yes')
  })

  it('refuses the port when it is not on the list, without connecting', async () => {
    const target = await serve(ok)
    expect(await codeOf(testClient(`http://public.test:${String(target.port)}/`))).toBe('blocked_port')
    expect(target.connections()).toBe(0)
  })

  it('does not use a proxy from the environment', async () => {
    const target = await serve(ok)
    const keep = { http: process.env['HTTP_PROXY'], lower: process.env['http_proxy'], all: process.env['ALL_PROXY'] }
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:1'
    process.env['http_proxy'] = 'http://127.0.0.1:1'
    process.env['ALL_PROXY'] = 'http://127.0.0.1:1'
    try {
      const res = await testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port] })
      expect(res.status).toBe(200)
      expect(target.requests).toHaveLength(1)
    } finally {
      for (const [name, value] of [
        ['HTTP_PROXY', keep.http],
        ['http_proxy', keep.lower],
        ['ALL_PROXY', keep.all],
      ] as const) {
        if (value === undefined) {
          Reflect.deleteProperty(process.env, name)
        } else {
          process.env[name] = value
        }
      }
    }
  })
})

describe('redirects', () => {
  it('follows a relative redirect and an absolute one, and reports the final address', async () => {
    const target = await serve((req, res) => {
      if (req.url === '/a') {
        res.writeHead(302, { location: '/b' })
      } else if (req.url === '/b') {
        res.writeHead(301, { location: `http://public.test:${String(target.port)}/c` })
      } else {
        res.writeHead(200)
        res.end('final')
        return
      }
      res.end()
    })
    const res = await testClient(`http://public.test:${String(target.port)}/a`, { allowedPorts: [target.port] })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('final')
    expect(res.redirected).toBe(true)
    expect(res.url).toBe(`http://public.test:${String(target.port)}/c`)
  })

  it.each([
    ['an IPv4 literal', 'http://10.0.0.1/'],
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['an IPv6 loopback literal', 'http://[::1]/'],
    ['an IPv4-mapped literal', 'http://[::ffff:10.0.0.1]/'],
    ['a decimal IPv4 literal', 'http://167772161/'],
    ['a name that resolves to a private address', 'http://internal.test/'],
    ['a name that resolves to the metadata address', 'http://metadata.test/'],
  ])('refuses a redirect to %s', async (_name, location) => {
    const target = await serve((_req, res) => {
      res.writeHead(302, { location })
      res.end()
    })
    expect(
      await codeOf(testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port, 80] })),
    ).toBe('blocked_address')
  })

  it('refuses a redirect to another scheme or port', async () => {
    for (const [location, code] of [
      ['ftp://example.com/', 'blocked_scheme'],
      ['file:///etc/passwd', 'blocked_scheme'],
      ['http://public.test:22/', 'blocked_port'],
      ['http://user:pw@public.test/', 'blocked_credentials'],
    ] as const) {
      const target = await serve((_req, res) => {
        res.writeHead(302, { location })
        res.end()
      })
      expect(
        await codeOf(testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port] })),
      ).toBe(code)
    }
  })

  it('refuses a redirect to a loopback address that the test client does not allow', async () => {
    // The test client allows 127.0.0.1 and nothing else: [::1] is the same machine, but not allowed.
    const target = await serve((_req, res) => {
      res.writeHead(307, { location: `http://[::1]:${String(target.port)}/` })
      res.end()
    })
    expect(
      await codeOf(testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port] })),
    ).toBe('blocked_address')
    expect(target.requests).toHaveLength(1) // only the first hop reached the server
  })

  it('stops after three redirects', async () => {
    let hits = 0
    const target = await serve((_req, res) => {
      hits += 1
      res.writeHead(302, { location: '/again' })
      res.end()
    })
    const url = `http://public.test:${String(target.port)}/`
    expect(await codeOf(testClient(url, { allowedPorts: [target.port] }))).toBe('too_many_redirects')
    expect(hits).toBe(4) // the first request and three redirects
    hits = 0
    expect(await codeOf(testClient(url, { allowedPorts: [target.port], maxRedirects: 1 }))).toBe('too_many_redirects')
    expect(hits).toBe(2)
    hits = 0
    expect(await codeOf(testClient(url, { allowedPorts: [target.port], maxRedirects: 0 }))).toBe('too_many_redirects')
    expect(hits).toBe(1)
    hits = 0
    // More than three is three.
    expect(await codeOf(testClient(url, { allowedPorts: [target.port], maxRedirects: 50 }))).toBe('too_many_redirects')
    expect(hits).toBe(4)
  })

  it('returns a redirect without a Location as the answer', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(302)
      res.end()
    })
    const res = await testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port] })
    expect(res.status).toBe(302)
  })

  it('turns a POST into a GET after 303 and keeps it after 307', async () => {
    const target = await serve((req, res) => {
      if (req.url === '/see-other') {
        res.writeHead(303, { location: '/done' })
      } else if (req.url === '/temporary') {
        res.writeHead(307, { location: '/done' })
      } else {
        res.writeHead(200)
        res.end('done')
        return
      }
      res.end()
    })
    const base = `http://public.test:${String(target.port)}`
    await testClient(`${base}/see-other`, {
      allowedPorts: [target.port],
      method: 'POST',
      body: 'x=1',
      headers: { 'content-type': 'text/plain' },
    })
    expect(target.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /see-other', 'GET /done'])
    expect(target.requests[1]?.body).toBe('')
    target.requests.length = 0
    await testClient(`${base}/temporary`, {
      allowedPorts: [target.port],
      method: 'POST',
      body: 'x=1',
      headers: { 'content-type': 'text/plain' },
    })
    expect(target.requests.map((r) => `${r.method} ${r.url} ${r.body}`)).toEqual([
      'POST /temporary x=1',
      'POST /done x=1',
    ])
  })

  it('does not send credentials to another origin after a redirect', async () => {
    const other = await serve(ok)
    const first = await serve((_req, res) => {
      res.writeHead(302, { location: `http://public.test:${String(other.port)}/` })
      res.end()
    })
    await testClient(`http://public.test:${String(first.port)}/`, {
      allowedPorts: [first.port, other.port],
      headers: { authorization: 'Bearer secret', cookie: 'a=b', 'x-keep': 'yes' },
    })
    expect(first.requests[0]?.headers.authorization).toBe('Bearer secret')
    expect(other.requests[0]?.headers.authorization).toBeUndefined()
    expect(other.requests[0]?.headers.cookie).toBeUndefined()
    expect(other.requests[0]?.headers['x-keep']).toBe('yes')
  })
})

describe('limits', () => {
  it('stops reading a body that grows past the cap', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(200) // no Content-Length: chunked
      res.write(Buffer.alloc(600))
      res.write(Buffer.alloc(600))
      res.end(Buffer.alloc(600))
    })
    const url = `http://public.test:${String(target.port)}/`
    expect(await codeOf(testClient(url, { allowedPorts: [target.port], maxBytes: 1000 }))).toBe('response_too_large')
    const whole = await testClient(url, { allowedPorts: [target.port], maxBytes: 1800 })
    expect(whole.body).toHaveLength(1800)
  })

  it('refuses at once when Content-Length is over the cap', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': '5000' })
      res.end(Buffer.alloc(5000))
    })
    expect(
      await codeOf(
        testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port], maxBytes: 1000 }),
      ),
    ).toBe('response_too_large')
  })

  it('has a default cap of 1 MiB', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(200)
      res.end(Buffer.alloc(1024 * 1024 + 1))
    })
    expect(
      await codeOf(testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port] })),
    ).toBe('response_too_large')
  })

  it('times out on a server that never answers', async () => {
    const target = await serve(() => {
      // never answers
    })
    const started = Date.now()
    expect(
      await codeOf(
        testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port], timeoutMs: 300 }),
      ),
    ).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('times out on a body that stalls', async () => {
    const target = await serve((_req, res) => {
      res.writeHead(200)
      res.write('start')
      // never ends
    })
    expect(
      await codeOf(
        testClient(`http://public.test:${String(target.port)}/`, { allowedPorts: [target.port], timeoutMs: 300 }),
      ),
    ).toBe('timeout')
  })

  it('stops when the caller aborts', async () => {
    const target = await serve(() => {
      // never answers
    })
    const controller = new AbortController()
    const pending = testClient(`http://public.test:${String(target.port)}/`, {
      allowedPorts: [target.port],
      signal: controller.signal,
    })
    setTimeout(() => {
      controller.abort()
    }, 100)
    expect(await codeOf(pending)).toBe('aborted')
  })
})
