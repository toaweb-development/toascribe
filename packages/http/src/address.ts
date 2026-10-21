import net from 'node:net'

import ipaddr from 'ipaddr.js'

// Which addresses a server-side request may go to (SECURITY §4 «SSRF», K-316). The rule is an allow-list: an address is
// reachable only when ipaddr.js classes it as `unicast`, which is what is left of the address space once loopback, private,
// link-local (the cloud metadata address 169.254.169.254 is here), carrier-grade NAT, multicast, broadcast, the
// documentation ranges, 6to4, NAT64, Teredo and the reserved blocks are taken away. A deny-list would have to name every
// block and would miss the next one.
//
// Two things ipaddr.js does not do for us:
// - An IPv4 address inside an IPv6 one (`::ffff:127.0.0.1`) is classed `ipv4Mapped`, which says nothing about the IPv4
//   address inside it. It is unwrapped first and the IPv4 address is judged.
// - Some IPv6 blocks that IANA marks as not globally reachable are `unicast` to ipaddr.js (the deprecated IPv4-compatible
//   `::7f00:1`, for one). They are listed below as extra blocks.

/** IPv6 blocks that are not globally reachable but that ipaddr.js still calls `unicast`. IANA IPv6 special-purpose registry. */
const EXTRA_BLOCKED_V6: readonly (readonly [ipaddr.IPv6, number])[] = [
  '::/96', // IPv4-compatible (deprecated): ::a.b.c.d, and the unspecified and loopback addresses
  '100::/64', // discard-only
  '2001::/23', // IETF protocol assignments: Teredo, benchmarking, ORCHID, AMT, ...
  '2001:db8::/32', // documentation
  '3fff::/20', // documentation
  '5f00::/16', // segment routing SIDs
].map((cidr) => {
  const [address, bits] = ipaddr.IPv6.parseCIDR(cidr)
  return [address, bits] as const
})

/** IPv4 blocks that are not globally reachable. ipaddr.js has most of them as `reserved`; they are named again so a change in its table cannot open one. */
const EXTRA_BLOCKED_V4: readonly (readonly [ipaddr.IPv4, number])[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map((cidr) => {
  const [address, bits] = ipaddr.IPv4.parseCIDR(cidr)
  return [address, bits] as const
})

/**
 * True when a request may be sent to `address`. Anything that is not a valid IP address text is false. The address is
 * what DNS returned or what the URL held, never the host name a user typed.
 */
export function isPublicAddress(address: string): boolean {
  // Node's own parser takes only the canonical forms. ipaddr.js also reads 1.2.3, 127.1 and 2130706433, which no resolver
  // returns and which a URL has already been turned out of; refusing them keeps the answer to «is this an address» single.
  if (net.isIP(address) === 0) {
    return false
  }
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(address)
  } catch {
    return false
  }
  // `::ffff:a.b.c.d` is the IPv4 address a.b.c.d on the wire, so judge that one.
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address()
  }
  if (parsed.range() !== 'unicast') {
    return false
  }
  if (parsed instanceof ipaddr.IPv4) {
    const v4 = parsed
    return !EXTRA_BLOCKED_V4.some(([block, bits]) => v4.match(block, bits))
  }
  const v6 = parsed
  return !EXTRA_BLOCKED_V6.some(([block, bits]) => v6.match(block, bits))
}
