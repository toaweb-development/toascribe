import dns from 'node:dns'
import net from 'node:net'

import { Agent, fetch } from 'undici'

import { isPublicAddress } from './address.ts'

// An HTTP client for addresses a user gave (webhooks, import from a URL, link previews; SECURITY §4 «SSRF», K-316). It
// refuses to talk to anything but the public internet:
// - the scheme is http or https, the port is one of an allow-list (80 and 443 unless the caller says more), and the URL
//   carries no user name or password;
// - every address the name resolves to is checked, and the socket is opened to one of exactly those addresses, so a second
//   DNS answer (rebinding) cannot send the request somewhere else;
// - a host written as an IP address never reaches DNS, so undici never calls the lookup for it. It is checked here, before
//   every hop (verified on undici 8.12.3 / Node 24: `http://127.0.0.1/` went through a client that only had a lookup hook);
// - redirects are followed by this file, one hop at a time, with the whole check on each, at most three of them;
// - there is a deadline, a cap on the body, and no proxy (undici's plain Agent ignores HTTP_PROXY and friends).

/** Why a request was refused or failed. Messages are safe to show; they never hold an address or a response. */
export const SAFE_FETCH_ERROR_CODES = [
  'invalid_url',
  'blocked_scheme',
  'blocked_port',
  'blocked_credentials',
  'blocked_address',
  'too_many_redirects',
  'bad_redirect',
  'response_too_large',
  'timeout',
  'aborted',
  'network',
] as const
export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR_CODES)[number]

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode

  constructor(code: SafeFetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SafeFetchError'
    this.code = code
  }
}

export interface SafeFetchOptions {
  /** Default GET. */
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly headers?: Readonly<Record<string, string>>
  /** Sent as it is. A redirect with 307 or 308 sends it again; 301, 302 and 303 turn a POST into a GET without it. */
  readonly body?: string | Uint8Array
  /** The ports a request may go to, on the first hop and on every redirect. Default 80 and 443. */
  readonly allowedPorts?: readonly number[]
  /** How many redirects to follow, 0 to 3. Default 3; a larger number is 3. */
  readonly maxRedirects?: number
  /** The whole request, redirects and body included. Default 10 s. */
  readonly timeoutMs?: number
  /** The most body bytes read, after decompression. Default 1 MiB. */
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

export interface SafeResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  /** The address the answer came from: the last one, after any redirects. */
  readonly url: string
  readonly redirected: boolean
  readonly body: Uint8Array
  /** The body as UTF-8 text. */
  text: () => string
}

export const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443]
export const MAX_REDIRECTS = 3
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_MAX_BYTES = 1024 * 1024
const MAX_URL_LENGTH = 2048
const CONNECT_TIMEOUT_MS = 5000
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
/** Not sent to another origin after a redirect. */
const ORIGIN_BOUND_HEADERS = ['authorization', 'cookie', 'proxy-authorization'] as const

export interface ResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** The hooks a test needs. They are not part of the package's public API (index.ts exports `safeFetch` and nothing of this). */
export interface SafeFetchInternals {
  /** Turns a host name into its addresses. Default: the system resolver, every address. */
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>
  /** Whether a request may go to an address. Default: `isPublicAddress`. */
  readonly isAllowed?: (address: string) => boolean
}

class BlockedAddressError extends Error {
  readonly code = 'EBLOCKED'

  constructor() {
    super('The address is not allowed')
    this.name = 'BlockedAddressError'
  }
}

async function systemResolve(hostname: string): Promise<readonly ResolvedAddress[]> {
  const found = await dns.promises.lookup(hostname, { all: true })
  return found.flatMap((entry) =>
    entry.family === 4 || entry.family === 6 ? [{ address: entry.address, family: entry.family }] : [],
  )
}

/** The `connect.lookup` of the Agent. Exported for the tests. */
export function createLookup(internals: SafeFetchInternals = {}): net.LookupFunction {
  const resolve = internals.resolve ?? systemResolve
  const isAllowed = internals.isAllowed ?? isPublicAddress
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error('The host name has no address'), { code: 'ENOTFOUND' }), '', 0)
          return
        }
        // All of them, not the first: a name with one public and one private address is refused.
        if (!addresses.every((entry) => isAllowed(entry.address))) {
          callback(new BlockedAddressError(), '', 0)
          return
        }
        const wanted = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family
        const usable = wanted === 4 || wanted === 6 ? addresses.filter((entry) => entry.family === wanted) : addresses
        const first = usable[0]
        if (first === undefined) {
          callback(
            Object.assign(new Error('The host name has no address of that family'), { code: 'ENOTFOUND' }),
            '',
            0,
          )
        } else if (options.all === true) {
          callback(
            null,
            usable.map((entry) => ({ address: entry.address, family: entry.family })),
          )
        } else {
          callback(null, first.address, first.family)
        }
      },
      (err: unknown) => {
        callback(err instanceof Error ? err : new Error('The host name could not be resolved'), '', 0)
      },
    )
  }
}

function isRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status)
}

function portOf(url: URL): number {
  if (url.port !== '') {
    return Number(url.port)
  }
  return url.protocol === 'https:' ? 443 : 80
}

/** The part of the checks that needs no DNS. Throws SafeFetchError. */
function checkTarget(url: URL, allowedPorts: readonly number[], isAllowed: (address: string) => boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('blocked_scheme', 'Only http and https addresses are allowed')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('blocked_credentials', 'An address with a user name or password is not allowed')
  }
  if (!allowedPorts.includes(portOf(url))) {
    throw new SafeFetchError('blocked_port', 'The port is not allowed')
  }
  // WHATWG URL has already turned 2130706433, 0x7f.1 and 127.1 into 127.0.0.1, and [::ffff:127.0.0.1] into [::ffff:7f00:1].
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  if (net.isIP(host) !== 0) {
    if (!isAllowed(host)) {
      throw new SafeFetchError('blocked_address', 'The address is not allowed')
    }
    return
  }
  const name = host.toLowerCase().replace(/\.$/, '')
  if (name === 'localhost' || name.endsWith('.localhost')) {
    throw new SafeFetchError('blocked_address', 'The address is not allowed')
  }
}

function parseUrl(input: string | URL): URL {
  const text = input instanceof URL ? input.href : input
  if (text.length > MAX_URL_LENGTH) {
    throw new SafeFetchError('invalid_url', 'The address is not valid')
  }
  try {
    return new URL(text)
  } catch {
    throw new SafeFetchError('invalid_url', 'The address is not valid')
  }
}

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = err
  while (current !== undefined && current !== null && chain.length < 8) {
    chain.push(current)
    current = current instanceof Error ? current.cause : undefined
  }
  return chain
}

/** undici reports every failure as `TypeError: fetch failed` with the real reason in `cause`. */
function translate(err: unknown, signal: AbortSignal, deadline: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) {
    return err
  }
  const chain = errorChain(err)
  if (chain.some((link) => link instanceof BlockedAddressError)) {
    return new SafeFetchError('blocked_address', 'The address is not allowed')
  }
  if (deadline.aborted) {
    return new SafeFetchError('timeout', 'The request took too long')
  }
  if (signal.aborted) {
    return new SafeFetchError('aborted', 'The request was cancelled')
  }
  const timedOut = chain.some(
    (link) =>
      link instanceof Error &&
      (link.name === 'TimeoutError' ||
        link.name === 'ConnectTimeoutError' ||
        Reflect.get(link, 'code') === 'UND_ERR_CONNECT_TIMEOUT' ||
        Reflect.get(link, 'code') === 'UND_ERR_HEADERS_TIMEOUT' ||
        Reflect.get(link, 'code') === 'UND_ERR_BODY_TIMEOUT'),
  )
  if (timedOut) {
    return new SafeFetchError('timeout', 'The request took too long', { cause: err })
  }
  return new SafeFetchError('network', 'The request failed', { cause: err })
}

/** What readCapped needs of a body. undici's and Node's own ReadableStream types do not agree, and both fit this. */
interface ByteStream {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>
    cancel: () => Promise<void>
    releaseLock: () => void
  }
  cancel: () => Promise<void>
}

async function readCapped(
  body: ByteStream | null,
  declaredLength: number | undefined,
  maxBytes: number,
): Promise<Uint8Array> {
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    await body?.cancel().catch(() => undefined)
    throw new SafeFetchError('response_too_large', 'The response is too large')
  }
  if (body === null) {
    return new Uint8Array(0)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || value === undefined) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new SafeFetchError('response_too_large', 'The response is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

export interface SafeFetch {
  (input: string | URL, options?: SafeFetchOptions): Promise<SafeResponse>
  /** Closes the client's connections. Call it when the process is shutting down. */
  close: () => Promise<void>
}

/** Makes a client. `safeFetch` in index.ts is the one every caller uses; tests make their own with a stub resolver. */
export function createSafeFetch(internals: SafeFetchInternals = {}): SafeFetch {
  const isAllowed = internals.isAllowed ?? isPublicAddress
  let agent: Agent | undefined

  function dispatcher(): Agent {
    // No proxy: this is a plain Agent, not EnvHttpProxyAgent, so HTTP_PROXY and HTTPS_PROXY are not read.
    agent ??= new Agent({
      connect: { lookup: createLookup(internals), timeout: CONNECT_TIMEOUT_MS },
      headersTimeout: DEFAULT_TIMEOUT_MS,
      bodyTimeout: DEFAULT_TIMEOUT_MS,
    })
    return agent
  }

  const client = async (input: string | URL, options: SafeFetchOptions = {}): Promise<SafeResponse> => {
    const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS
    const maxRedirects = Math.max(0, Math.min(MAX_REDIRECTS, Math.trunc(options.maxRedirects ?? MAX_REDIRECTS)))
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const caller = options.signal ?? new AbortController().signal
    const signal = AbortSignal.any([deadline, caller])

    let url = parseUrl(input)
    let method: string = options.method ?? 'GET'
    let body: string | Uint8Array | undefined = options.body
    let headers = new Headers(options.headers)

    for (let hop = 0; ; hop += 1) {
      checkTarget(url, allowedPorts, isAllowed)
      let response: Awaited<ReturnType<typeof fetch>>
      try {
        response = await fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          redirect: 'manual',
          dispatcher: dispatcher(),
          signal,
        })
      } catch (err) {
        throw translate(err, caller, deadline)
      }

      const location = response.headers.get('location')
      if (isRedirect(response.status) && location !== null) {
        await response.body?.cancel().catch(() => undefined)
        if (hop >= maxRedirects) {
          throw new SafeFetchError('too_many_redirects', 'The address redirects too many times')
        }
        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          throw new SafeFetchError('bad_redirect', 'The redirect points nowhere')
        }
        if (next.href.length > MAX_URL_LENGTH) {
          throw new SafeFetchError('bad_redirect', 'The redirect points nowhere')
        }
        // What a browser does: 303, and 301/302 after a POST, become a GET without a body.
        const becomesGet =
          (response.status === 303 && method !== 'HEAD') ||
          ((response.status === 301 || response.status === 302) && method === 'POST')
        if (becomesGet) {
          method = 'GET'
          body = undefined
          headers = new Headers(headers)
          headers.delete('content-type')
          headers.delete('content-length')
        }
        if (next.origin !== url.origin) {
          headers = new Headers(headers)
          for (const name of ORIGIN_BOUND_HEADERS) {
            headers.delete(name)
          }
        }
        url = next
        continue
      }

      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      let bytes: Uint8Array
      try {
        bytes = await readCapped(response.body, Number.isFinite(declared) ? declared : undefined, maxBytes)
      } catch (err) {
        throw translate(err, caller, deadline)
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers([...response.headers]),
        url: url.href,
        redirected: hop > 0,
        body: bytes,
        text: () => new TextDecoder().decode(bytes),
      }
    }
  }

  return Object.assign(client, {
    close: async () => {
      const open = agent
      agent = undefined
      await open?.close()
    },
  })
}
