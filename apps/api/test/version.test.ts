import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { HealthResponse } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { readPackageVersion } from '../src/lib/version.ts'
import { UNREACHABLE_DATABASE_URL, makeApp } from './helpers.ts'

function versionOf(url: URL): string {
  const raw: unknown = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'))
  if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
    return raw.version
  }
  throw new Error(`${url.pathname} has no version`)
}

// The root package.json is the source of truth (VERSIONING_STANDARD_2026 §3); the package manifests mirror it.
describe('version', () => {
  const rootVersion = versionOf(new URL('../../../package.json', import.meta.url))

  it('the API package mirrors the root package.json version', () => {
    expect(versionOf(new URL('../package.json', import.meta.url))).toBe(rootVersion)
    expect(readPackageVersion()).toBe(rootVersion)
  })

  it('/api/health reports the root package.json version', async () => {
    const { app, pool } = makeApp(UNREACHABLE_DATABASE_URL, readPackageVersion())
    const res = await app.request('/api/health')
    expect(HealthResponse.parse(await res.json()).version).toBe(rootVersion)
    await pool.end()
  })
})
