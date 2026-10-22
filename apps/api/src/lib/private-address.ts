import { isIP } from 'node:net'

import { normalizeIp } from './client-ip.ts'

/** IPv4 blocks that only mean something inside a network: private, loopback, link-local, carrier-grade NAT and «this network». */
const PRIVATE_V4: readonly (readonly [number, number])[] = [
  [0x0a000000, 8], // 10.0.0.0/8
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0x64400000, 10], // 100.64.0.0/10
  [0x00000000, 8], // 0.0.0.0/8
]

function v4Number(address: string): number {
  return address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0)
}

/**
 * True when `address` is a private address (RFC 1918, loopback, link-local, carrier-grade NAT, IPv6 unique local `fc00::/7`
 * and link-local `fe80::/10`): the kind a reverse proxy in front of the stack has. False for a public address and for text that
 * is not an address.
 */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeIp(address)
  if (normalized === undefined) {
    return false
  }
  if (isIP(normalized) === 4) {
    const value = v4Number(normalized)
    return PRIVATE_V4.some(
      ([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)),
    )
  }
  if (normalized === '::1' || normalized === '::') {
    return true
  }
  const head = normalized.split(':')[0] ?? ''
  const first = head === '' ? 0 : Number.parseInt(head, 16)
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
}
