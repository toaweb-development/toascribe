// The update check (M1.7, K-290) against stored answers from ghcr.io, never the network: the anonymous token, then the tag list
// page by page; the newest plain X.Y.Z wins (no prerelease, no `sha-…`, no `latest`); every request carries only the user agent
// (and the anonymous token); a next page on another host, a refusal or garbage is a failure with a reason, not a crash.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { checkForUpdate, ghcrSource, isNewer, newestRelease, serverAllowsUpdateCheck } from '../src/index.ts'
import type { Fetcher } from '../src/index.ts'

const page = (n: number) =>
  new Uint8Array(readFileSync(new URL(`fixtures/ghcr-tags-page-${String(n)}.json`, import.meta.url)))
const text = (value: unknown) => new Uint8Array(Buffer.from(JSON.stringify(value)))

interface Seen {
  url: string
  headers: Readonly<Record<string, string>>
}

/** A registry in memory: the token, then two pages of the stored tag list (the second through a relative Link). */
function registry(overrides: { next?: string; tokenStatus?: number; secondPage?: Uint8Array } = {}) {
  const seen: Seen[] = []
  const fetch: Fetcher = (url, options) => {
    seen.push({ url, headers: options.headers })
    const target = new URL(url)
    const reply = (status: number, body: Uint8Array, headers: Record<string, string> = {}) =>
      Promise.resolve({ status, headers: new Headers(headers), body })
    if (target.pathname === '/token') return reply(overrides.tokenStatus ?? 200, text({ token: 'anonym' }))
    if (target.searchParams.get('last') === null) {
      return reply(200, page(1), {
        link: `<${overrides.next ?? '/v2/toaweb-development/toascribe-api/tags/list?last=latest&n=1000'}>; rel="next"`,
      })
    }
    return reply(200, overrides.secondPage ?? page(2))
  }
  return { fetch, seen }
}

describe('newestRelease and isNewer', () => {
  it('takes plain releases only, compared by number', () => {
    expect(newestRelease(['0.9.0', '0.10.0', '0.11.0-rc.1', 'latest', 'sha-abc1234'])).toBe('0.10.0')
    expect(newestRelease(['latest', 'sha-abc1234', '1.0.0-beta'])).toBeNull()
    expect(newestRelease(['v1.2.3'])).toBe('1.2.3')
    expect(newestRelease(['01.2.3', '1.2', '1.2.3.4'])).toBeNull()
  })

  it('says whether a release is newer than the one that runs', () => {
    expect(isNewer('0.7.0', '0.6.0')).toBe(true)
    expect(isNewer('0.6.0', '0.6.0')).toBe(false)
    expect(isNewer('0.5.9', '0.6.0')).toBe(false)
    expect(isNewer('0.7.0', '0.7.0-rc.1')).toBe(true)
    expect(isNewer(null, '0.6.0')).toBe(false)
    expect(isNewer('0.7.0', '0.3.0-e2e')).toBe(true)
  })
})

describe('the ghcr.io source', () => {
  it('reads every page and finds the newest release; each request says only who asks', async () => {
    const { fetch, seen } = registry()
    const status = await checkForUpdate(ghcrSource({ fetch }), '0.6.0', new Date('2026-10-27T12:00:00Z'))
    expect(status).toEqual({
      checkedAt: '2026-10-27T12:00:00.000Z',
      current: '0.6.0',
      latest: '0.10.0',
      ok: true,
      error: null,
    })
    expect(seen.map((request) => request.url)).toEqual([
      'https://ghcr.io/token?scope=repository%3Atoaweb-development%2Ftoascribe-api%3Apull',
      'https://ghcr.io/v2/toaweb-development/toascribe-api/tags/list?n=1000',
      'https://ghcr.io/v2/toaweb-development/toascribe-api/tags/list?last=latest&n=1000',
    ])
    expect(seen[0]?.headers).toEqual({ 'User-Agent': 'toascribe' })
    for (const request of seen.slice(1)) {
      expect(request.headers).toEqual({
        'User-Agent': 'toascribe',
        Accept: 'application/json',
        Authorization: 'Bearer anonym',
      })
    }
    // Nothing about the site: no version, no address, no query of ours beyond the registry's own.
    expect(JSON.stringify(seen)).not.toContain('0.6.0')
  })

  it('refuses a next page on another host', async () => {
    const { fetch, seen } = registry({ next: 'https://evil.example/v2/toaweb-development/toascribe-api/tags/list' })
    const status = await checkForUpdate(ghcrSource({ fetch }), '0.6.0', new Date())
    expect(status.ok).toBe(false)
    expect(status.error).toContain('next page elsewhere')
    expect(seen).toHaveLength(2)
  })

  it('turns a refusal or garbage into a failed status with a reason and no address', async () => {
    const refused = await checkForUpdate(
      ghcrSource({ fetch: registry({ tokenStatus: 429 }).fetch }),
      '0.6.0',
      new Date(),
    )
    expect(refused).toMatchObject({ ok: false, latest: null, error: 'the registry refused a token (429)' })
    const garbage = await checkForUpdate(
      ghcrSource({ fetch: registry({ secondPage: new Uint8Array(Buffer.from('<html>')) }).fetch }),
      '0.6.0',
      new Date(),
    )
    expect(garbage).toMatchObject({ ok: false, error: 'the registry did not answer with JSON' })
    const thrown = await checkForUpdate(
      { tags: () => Promise.reject(new Error('connect ECONNREFUSED https://ghcr.io/token at /app/x.js')) },
      '0.6.0',
      new Date(),
    )
    expect(thrown.error).toBe('connect ECONNREFUSED [adresse] at [sti]')
  })
})

describe('TOASCRIBE_UPDATE_CHECK', () => {
  it('is on unless it says off', () => {
    expect(serverAllowsUpdateCheck(undefined)).toBe(true)
    expect(serverAllowsUpdateCheck('')).toBe(true)
    expect(serverAllowsUpdateCheck('on')).toBe(true)
    expect(serverAllowsUpdateCheck('off')).toBe(false)
    expect(serverAllowsUpdateCheck(' OFF ')).toBe(false)
  })
})
