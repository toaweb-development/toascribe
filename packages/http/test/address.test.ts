import { describe, expect, it } from 'vitest'

import { isPublicAddress } from '../src/address.ts'

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8', // an IPv4-mapped address is judged by the IPv4 address in it
  ])('allows the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local, the cloud metadata address'],
    ['169.254.0.1', 'link-local'],
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'this network'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex form'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    ['::7f00:1', 'IPv4-compatible loopback'],
    ['::a00:1', 'IPv4-compatible private'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd00::1', 'unique local'],
    ['fc00::1', 'unique local'],
    ['ff02::1', 'IPv6 multicast'],
    ['2001:db8::1', 'documentation'],
    ['2001::1', 'Teredo'],
    ['2002:7f00:1::', '6to4 of 127.0.0.1'],
    ['64:ff9b::7f00:1', 'NAT64 of 127.0.0.1'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['100::1', 'discard-only'],
    ['3fff::1', 'documentation'],
  ])('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each([
    '',
    'localhost',
    'example.com',
    '999.1.1.1',
    '1.2.3',
    '127.1',
    '2130706433',
    '0x7f.1',
    'not an address',
    '::g',
  ])('refuses %j, which is not an address in the form DNS returns', (text) => {
    expect(isPublicAddress(text)).toBe(false)
  })
})
