import { createHash } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ADMIN_STYLE_ATTRIBUTES } from '../csp-style-attributes.ts'

// `'unsafe-hashes'` is allowed for inline styles only, by Tor's decision (M0.5, round 1): never for a script. These read the Nuxt
// configs the way Nuxt does (`defineNuxtConfig` returns what it is given) and look at the CSP directives they hand to nuxt-security.
// The built header itself is checked by the end-to-end tests (e2e/headers.spec.ts), which also compare the list with the HTML the
// server draws.

interface Config {
  security?: { headers?: { contentSecurityPolicy?: Record<string, unknown> } }
}

const loaded = new Map<string, Config>()

beforeAll(async () => {
  vi.stubGlobal('defineNuxtConfig', (config: Config) => config)
  // Loaded by URL, not by a static import: the configs use Nuxt's global `defineNuxtConfig`, which the app's typecheck of this test
  // does not declare, and a static import would pull them into it.
  const paths: Record<string, string> = {
    base: '../../../packages/nuxt-base/nuxt.config.ts',
    theme: '../../../themes/default/nuxt.config.ts',
    site: '../../site/nuxt.config.ts',
    admin: '../nuxt.config.ts',
  }
  for (const [name, path] of Object.entries(paths)) {
    const module = (await import(/* @vite-ignore */ new URL(path, import.meta.url).href)) as { default: Config }
    loaded.set(name, module.default)
  }
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const config = (name: string): Config => loaded.get(name) ?? {}

/** The directives a layer sets, as nuxt-security gets them (layers concatenate arrays: base first). */
function directivesOf(...names: string[]): Map<string, string[]> {
  const merged = new Map<string, string[]>()
  for (const name of names) {
    for (const [directive, value] of Object.entries(config(name).security?.headers?.contentSecurityPolicy ?? {})) {
      merged.set(directive, [...(merged.get(directive) ?? []), ...(Array.isArray(value) ? (value as string[]) : [])])
    }
  }
  return merged
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

describe('the admin CSP', () => {
  it("has 'unsafe-hashes' in style-src-attr and nowhere else", () => {
    const directives = directivesOf('base', 'admin')
    const withHashes = [...directives].filter(([, values]) => values.includes("'unsafe-hashes'")).map(([name]) => name)
    expect(withHashes).toEqual(['style-src-attr'])
    for (const name of ['script-src', 'script-src-attr', 'script-src-elem', 'style-src']) {
      expect(directives.get(name) ?? [], name).not.toContain("'unsafe-hashes'")
    }
    // Not anywhere in the config (the development block included), by text: a directive added in a form this reader does not follow.
    expect(JSON.stringify(config('admin')).match(/unsafe-hashes/g)).toHaveLength(1)
  })

  it('lets through the hash of each string on the list, and nothing else', () => {
    const values = directivesOf('base', 'admin').get('style-src-attr') ?? []
    expect(values).toEqual(["'unsafe-hashes'", ...ADMIN_STYLE_ATTRIBUTES.map(({ value }) => sha256(value))])
    expect(values).not.toContain("'unsafe-inline'")
  })
})

describe('the list of inline styles', () => {
  it('has each string once, with a reason', () => {
    const values = ADMIN_STYLE_ATTRIBUTES.map(({ value }) => value)
    expect(new Set(values).size).toBe(values.length)
    for (const { value, reason } of ADMIN_STYLE_ATTRIBUTES) {
      expect(value.trim(), 'a string').not.toBe('')
      expect(reason.trim().length, `the reason for ${value}`).toBeGreaterThan(20)
    }
  })

  it('holds only custom properties and no other CSS the page could use against itself', () => {
    for (const { value } of ADMIN_STYLE_ATTRIBUTES) {
      expect(value, value).toMatch(/^(?:--[a-z-]+:[^;]+;|[a-z-]+:[^;]+;)+$/)
      expect(value, value).not.toMatch(/url\(|expression|@import|javascript:/i)
    }
  })
})

describe('the other configs', () => {
  it("do not mention 'unsafe-hashes' at all: the site, the theme and the shared layer", () => {
    for (const name of ['base', 'theme', 'site']) {
      expect(JSON.stringify(config(name)), name).not.toContain('unsafe-hashes')
    }
    expect([...directivesOf('base', 'theme', 'site')].flatMap(([, values]) => values)).not.toContain("'unsafe-hashes'")
  })
})
