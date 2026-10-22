import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { UNKNOWN_IP, getClientIp, normalizeIp, rateLimitKey } from '../src/lib/client-ip.ts'

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::1', '::1'],
    ['fe80::1%eth0', 'fe80::1'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected)
  })

  it.each([
    '',
    'unknown',
    '203.0.113.7, 10.0.0.1',
    '203.0.113.7:443',
    '999.1.1.1',
    '1.2.3',
    '0x7f.1',
    'example.com',
    "1.2.3.4'; drop table",
  ])('does not take %j for an address', (input) => {
    expect(normalizeIp(input)).toBeUndefined()
  })
})

describe('rateLimitKey', () => {
  it('leaves an IPv4 address alone', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7')
    expect(rateLimitKey(UNKNOWN_IP)).toBe(UNKNOWN_IP)
  })

  it.each([
    ['2001:db8:0:1:aaaa:bbbb:cccc:dddd', '2001:db8:0:1::'],
    ['2001:DB8:0:1:ffff:ffff:ffff:ffff', '2001:db8:0:1::'],
    ['2001:db8:0:1::1', '2001:db8:0:1::'],
    ['2001:db8:0:1::', '2001:db8:0:1::'],
    ['2001:db8::1', '2001:db8:0:0::'],
    ['2001:db8::', '2001:db8:0:0::'],
    ['::1', '0:0:0:0::'],
    ['::', '0:0:0:0::'],
    ['fe80::1', 'fe80:0:0:0::'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4::'],
    ['1:2:3::8', '1:2:3:0::'],
  ])('counts %s as the network %s', (address, key) => {
    expect(rateLimitKey(address)).toBe(key)
  })

  it('gives every address of one /64 the same key and another /64 another', () => {
    expect(rateLimitKey('2001:db8:5:6::1')).toBe(rateLimitKey('2001:db8:5:6:dead:beef:0:42'))
    expect(rateLimitKey('2001:db8:5:6::1')).not.toBe(rateLimitKey('2001:db8:5:7::1'))
  })
})

describe('getClientIp with app.request (no socket)', () => {
  const app = new Hono().get('/ip', (c) => c.text(getClientIp(c)))
  const ipOf = async (headers: Record<string, string>) => (await app.request('/ip', { headers })).text()

  it('reads X-Real-IP', async () => {
    expect(await ipOf({ 'x-real-ip': '198.51.100.9' })).toBe('198.51.100.9')
    expect(await ipOf({ 'x-real-ip': '::ffff:198.51.100.9' })).toBe('198.51.100.9')
  })

  it('never reads X-Forwarded-For, alone or next to X-Real-IP', async () => {
    expect(await ipOf({ 'x-forwarded-for': '198.51.100.9' })).toBe(UNKNOWN_IP)
    expect(await ipOf({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '198.51.100.9' })).toBe('198.51.100.9')
    expect(await ipOf({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7', forwarded: 'for=8.8.8.8' })).toBe(UNKNOWN_IP)
  })

  it('answers the placeholder when no address can be read, also for a header that is not an address', async () => {
    expect(await ipOf({})).toBe(UNKNOWN_IP)
    expect(await ipOf({ 'x-real-ip': 'not-an-address' })).toBe(UNKNOWN_IP)
    expect(await ipOf({ 'x-real-ip': '1.2.3.4, 5.6.7.8' })).toBe(UNKNOWN_IP)
  })
})

describe('getClientIp on a real socket (direct access, no proxy)', () => {
  const app = new Hono().get('/ip', (c) => c.text(getClientIp(c)))
  let server: ReturnType<typeof serve>
  let base: string

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => {
        base = `http://127.0.0.1:${String(info.port)}`
        resolve()
      })
    })
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  it('falls back to the address of the connection when X-Real-IP is absent', async () => {
    expect(await (await fetch(`${base}/ip`)).text()).toBe('127.0.0.1')
  })

  it('still ignores X-Forwarded-For, and prefers X-Real-IP when it is there', async () => {
    expect(await (await fetch(`${base}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6' } })).text()).toBe('127.0.0.1')
    expect(await (await fetch(`${base}/ip`, { headers: { 'x-real-ip': '198.51.100.9' } })).text()).toBe('198.51.100.9')
  })
})
