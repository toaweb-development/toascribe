// TOASCRIBE_TRUSTED_PROXY empty and every request from one private address: one warning in the log, and the state is kept
// for the setup wizard and Site Health. No database is needed: the watching is in memory.
import { describe, expect, it } from 'vitest'

import { isPrivateAddress } from '../src/lib/private-address.ts'
import {
  PROXY_CHECK_MIN_REQUESTS,
  PROXY_CHECK_MINUTES,
  PROXY_CHECK_REQUESTS,
  createProxyCheck,
} from '../src/services/proxy-check.ts'
import { UNREACHABLE_DATABASE_URL, makeApp, memoryLogger } from './helpers.ts'

function watch(trustedProxy = '') {
  const log = memoryLogger()
  let now = new Date('2027-01-10T12:00:00Z')
  const check = createProxyCheck({ trustedProxy, logger: log.logger, clock: () => now })
  return {
    check,
    lines: log.lines,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

const warnings = (lines: readonly Record<string, unknown>[]) => lines.filter((line) => line['level'] === 40)

describe('isPrivateAddress', () => {
  it.each([
    '10.231.97.1',
    '10.0.0.1',
    '172.16.0.5',
    '172.31.255.254',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '::1',
    'fd12:3456:789a::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.1.2.3',
  ])('%s is private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '203.0.113.7',
    '172.15.255.255',
    '172.32.0.1',
    '100.128.0.1',
    '100.63.255.255',
    '192.169.0.1',
    '2001:db8::1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
    'not an address',
    '',
  ])('%j is not', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('the proxy check', () => {
  it('writes one warning that names the variable when the first requests all carry the same private address', () => {
    const { check, lines } = watch()
    for (let n = 0; n < PROXY_CHECK_REQUESTS; n += 1) {
      expect(check.status().state).toBe('watching')
      check.observe('10.231.97.1')
    }
    expect(check.status()).toEqual({ state: 'warning', observed: PROXY_CHECK_REQUESTS, address: '10.231.97.1' })
    const found = warnings(lines)
    expect(found).toHaveLength(1)
    expect(found[0]?.['variable']).toBe('TOASCRIBE_TRUSTED_PROXY')
    expect(String(found[0]?.['msg'])).toContain('TOASCRIBE_TRUSTED_PROXY is empty')
    expect(String(found[0]?.['msg'])).toContain('shares one rate-limit bucket')
    expect(String(found[0]?.['msg'])).toContain('reverse proxy')

    // And only once, however many requests come after.
    for (let n = 0; n < 200; n += 1) {
      check.observe('10.231.97.1')
    }
    expect(warnings(lines)).toHaveLength(1)
    expect(check.status().observed).toBe(PROXY_CHECK_REQUESTS)
  })

  it('does not warn when two different addresses show up, and is settled at once', () => {
    const { check, lines } = watch()
    for (let n = 0; n < 10; n += 1) {
      check.observe('10.231.97.1')
    }
    check.observe('10.231.97.2')
    expect(check.status().state).toBe('ok')
    for (let n = 0; n < 200; n += 1) {
      check.observe('10.231.97.1')
    }
    expect(warnings(lines)).toHaveLength(0)
    expect(check.status().state).toBe('ok')
  })

  it('does not warn for a public address, even when it is always the same', () => {
    const { check, lines } = watch()
    for (let n = 0; n < PROXY_CHECK_REQUESTS + 5; n += 1) {
      check.observe('203.0.113.7')
    }
    expect(warnings(lines)).toHaveLength(0)
    expect(check.status().state).toBe('ok')
  })

  it('does not look at all, nor warn, when the variable is set', () => {
    const { check, lines } = watch('10.231.97.250')
    for (let n = 0; n < PROXY_CHECK_REQUESTS * 2; n += 1) {
      check.observe('10.231.97.250')
    }
    expect(warnings(lines)).toHaveLength(0)
    expect(check.status()).toEqual({ state: 'configured', observed: 0, address: null })
  })

  it('ignores requests with no address or one that is not an address (a healthcheck from inside the container)', () => {
    const { check } = watch()
    for (let n = 0; n < 100; n += 1) {
      check.observe(undefined)
      check.observe('garbage')
    }
    expect(check.status()).toEqual({ state: 'watching', observed: 0, address: null })
  })

  it('decides on a quiet site too: ten requests and ten minutes', () => {
    const { check, lines, advance } = watch()
    for (let n = 0; n < PROXY_CHECK_MIN_REQUESTS; n += 1) {
      check.observe('192.168.1.5')
    }
    expect(check.status().state).toBe('watching')
    advance(PROXY_CHECK_MINUTES * 60_000)
    check.observe('192.168.1.5')
    expect(check.status().state).toBe('warning')
    expect(warnings(lines)).toHaveLength(1)
  })

  it('treats the same address written two ways as one', () => {
    const { check } = watch()
    for (let n = 0; n < PROXY_CHECK_REQUESTS; n += 1) {
      check.observe(n % 2 === 0 ? '10.1.2.3' : '::ffff:10.1.2.3')
    }
    expect(check.status().state).toBe('warning')
  })
})

describe('the proxy check in the app', () => {
  async function requests(trustedProxy: string | undefined, addresses: readonly (string | undefined)[]) {
    const made = makeApp(UNREACHABLE_DATABASE_URL, trustedProxy === undefined ? {} : { trustedProxy })
    try {
      for (const address of addresses) {
        const res = await made.app.request('/api/v1/openapi.json', {
          headers: address === undefined ? {} : { 'x-real-ip': address },
        })
        expect(res.status).toBe(200)
      }
      return { lines: made.lines, status: made.services.proxy.status() }
    } finally {
      await made.pool.end()
    }
  }

  const same = Array.from({ length: PROXY_CHECK_REQUESTS }, () => '10.231.97.1')

  it('warns once, in the log of the app, when the variable is empty and every request is from one private address', async () => {
    const { lines, status } = await requests('', same)
    expect(status.state).toBe('warning')
    expect(warnings(lines)).toHaveLength(1)
    // Not given at all is empty.
    expect((await requests(undefined, same)).status.state).toBe('warning')
  })

  it('does not warn when the variable is set, or the addresses differ, or a request has no X-Real-IP', async () => {
    expect((await requests('10.231.97.250', same)).status.state).toBe('configured')
    const differ = await requests('', [...same.slice(0, 20), '10.231.97.9', ...same.slice(20)])
    expect(differ.status.state).toBe('ok')
    expect(warnings(differ.lines)).toHaveLength(0)
    const none = await requests(
      '',
      Array.from({ length: PROXY_CHECK_REQUESTS }, () => undefined),
    )
    expect(none.status.state).toBe('watching')
    expect(warnings(none.lines)).toHaveLength(0)
  })
})
