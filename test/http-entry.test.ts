// @toascribe/http/testing makes a client that may reach any address (a test's own name lookup and address rule). Only tests may
// import it: app code fetches through `safeFetch`, which refuses private addresses (security §4 SSRF; AGENTS.md, packages/http).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', 'dist', '.nuxt', '.output', 'test', 'e2e'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|vue|mts)$/.test(name) ? [path] : []
  })
}

describe('@toascribe/http/testing', () => {
  it('is imported by tests only', () => {
    const offenders = ['apps', 'packages', 'cli', 'themes']
      .flatMap((top) => sources(join(ROOT, top)))
      .filter((path) => !path.endsWith(join('packages', 'http', 'src', 'testing.ts')))
      .filter((path) => /@toascribe\/http\/testing|createSafeFetch\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))
    // safe-fetch.ts defines it, and index.ts uses it once to make `safeFetch`.
    expect(offenders.sort()).toEqual(['packages/http/src/index.ts', 'packages/http/src/safe-fetch.ts'])
  })
})
