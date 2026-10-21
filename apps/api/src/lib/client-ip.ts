import { isIP } from 'node:net'

import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

/**
 * What stands in for an address that cannot be read. It is a real value so that rate limiting still counts such requests
 * (all in one bucket) instead of skipping them.
 */
export const UNKNOWN_IP = '0.0.0.0'

/**
 * One text form for an address: no surrounding space, no IPv6 zone id, lower case, and an IPv4 address written as
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) as plain IPv4, so the same client is one key. Undefined when it is not an address.
 */
export function normalizeIp(text: string): string | undefined {
  const withoutZone = text.trim().replace(/%.*$/, '')
  const version = isIP(withoutZone)
  if (version === 0) {
    return undefined
  }
  const lower = withoutZone.toLowerCase()
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)
  const mappedV4 = mapped?.[1]
  if (mappedV4 !== undefined && isIP(mappedV4) === 4) {
    return mappedV4
  }
  return lower
}

/**
 * The address of the client (K-026, K-313). The proxy sets `X-Real-IP` from the connection it saw and replaces whatever the
 * visitor sent (docker/proxy/Caddyfile), so the header is the only forwarded value this reads. `X-Forwarded-For` is a list
 * the visitor can write the left end of, and is never read.
 *
 * Without the header (a direct request in development, or a header that is not an address) it is the address of the TCP
 * connection, and where even that is not available (a test calling `app.request()`), UNKNOWN_IP.
 */
export function getClientIp(c: Context): string {
  const header = c.req.header('x-real-ip')
  const fromHeader = header === undefined ? undefined : normalizeIp(header)
  if (fromHeader !== undefined) {
    return fromHeader
  }
  try {
    const address = getConnInfo(c).remote.address
    const fromSocket = address === undefined ? undefined : normalizeIp(address)
    if (fromSocket !== undefined) {
      return fromSocket
    }
  } catch {
    // No socket on this context (app.request() in a test).
  }
  return UNKNOWN_IP
}

/** Expands an IPv6 address (any valid text form, no zone, no embedded IPv4) into its eight groups. */
function ipv6Groups(address: string): number[] | undefined {
  if (address.includes('.')) {
    return undefined // ::ffff:1.2.3.4 style: normalizeIp turned the mapped ones into IPv4 already
  }
  const halves = address.split('::')
  if (halves.length > 2) {
    return undefined
  }
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16)))
  const head = parse(halves[0] ?? '')
  const tail = parse(halves[1] ?? '')
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return undefined
  }
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => 0), ...tail]
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : undefined
}

/**
 * The key a rate limit counts an address under. An IPv4 address is its own key. An IPv6 address is cut to its /64: one
 * subscriber is handed a whole /64 and can change the rest of the address at will, so counting full addresses would give
 * them 2^64 fresh allowances. The key is written as the network address (`2001:db8:0:1::`).
 */
export function rateLimitKey(ip: string): string {
  if (isIP(ip) !== 6) {
    return ip
  }
  const groups = ipv6Groups(ip)
  if (groups === undefined) {
    return ip
  }
  const prefix = groups.slice(0, 4).map((group) => group.toString(16))
  return `${prefix.join(':')}::`
}
