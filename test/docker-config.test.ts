// Checks on the files a user downloads and runs (docker/compose.yaml, docker/.env.example) that a build or a
// type check cannot catch. The stack itself is proven by CI, which builds the images and runs `docker compose up`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8')
}

const compose = read('docker/compose.yaml')
const envExample = read('docker/.env.example')
const caddyfile = read('docker/proxy/Caddyfile')
const composeBuild = read('docker/compose.build.yaml')

/** Names set in .env.example, commented out or not: `NAME=` at the start of a line. */
function documentedVariables(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

/** Variables compose reads from .env: every `${NAME` in the file. */
function interpolatedVariables(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

describe('docker/compose.yaml', () => {
  it('names every image after the root version', () => {
    const rootManifest: unknown = JSON.parse(read('package.json'))
    const version =
      typeof rootManifest === 'object' && rootManifest !== null && 'version' in rootManifest
        ? rootManifest.version
        : undefined
    expect(typeof version).toBe('string')
    // One default per image, all the same, and the same as package.json (VERSIONING_STANDARD §3: update every mirror).
    const defaults = [
      ...compose.matchAll(/\$\{TOASCRIBE_VERSION:-([^}]+)\}/g),
      ...composeBuild.matchAll(/\$\{TOASCRIBE_VERSION:-([^}]+)\}/g),
    ].map((match) => match[1])
    expect(defaults.length).toBeGreaterThanOrEqual(10)
    for (const found of defaults) expect(found).toBe(version)
    expect(envExample).toContain(`TOASCRIBE_VERSION=${String(version)}`)
  })

  it('reads only variables that .env.example documents', () => {
    const documented = documentedVariables(envExample)
    const missing = [...interpolatedVariables(compose)].filter((name) => !documented.has(name))
    expect(missing).toEqual([])
  })

  it('stops with a message when a password is empty', () => {
    for (const name of ['POSTGRES_PASSWORD', 'POSTGRES_OWNER_PASSWORD', 'POSTGRES_APP_PASSWORD']) {
      expect(compose).toContain(`\${${name}:?`)
    }
  })

  it('gives MIGRATION_DATABASE_URL to one service only', () => {
    expect(compose.match(/MIGRATION_DATABASE_URL:/g)).toHaveLength(1)
    const migrate = compose.slice(compose.indexOf('  migrate:'), compose.indexOf('  postgres:'))
    expect(migrate).toContain('MIGRATION_DATABASE_URL:')
  })

  it('publishes exactly one port, on the proxy', () => {
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1)
    const proxy = compose.slice(compose.indexOf('  proxy:'), compose.indexOf('  site:'))
    expect(proxy).toContain('ports:')
  })

  it('needs no file from the repo at run time', () => {
    // A bind mount of a repo file would break for a user who downloads only compose.yaml and .env.
    expect(compose).not.toMatch(/^\s+- \.{1,2}\//m)
    expect(compose).not.toMatch(/^\s+env_file:/m)
  })
})

describe('docker/compose.build.yaml', () => {
  /** The lines that say what is built: image names, Dockerfiles and build arguments, without the context. */
  function buildLines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(image: ghcr\.io\/|dockerfile: |APP: |HEALTH_PATH: )/.test(line))
      .sort()
  }

  it('builds the same images as compose.yaml', () => {
    const fromCompose = buildLines(compose)
    expect(fromCompose.length).toBeGreaterThanOrEqual(11)
    expect(buildLines(composeBuild)).toEqual(fromCompose)
  })

  it('needs no password to be read', () => {
    expect(composeBuild).not.toContain(':?')
  })
})

describe('docker/.env.example', () => {
  it('has no value for any password or secret', () => {
    const lines = envExample.split('\n').filter((line) => /^[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*=/.test(line))
    expect(lines.length).toBeGreaterThanOrEqual(3)
    for (const line of lines) expect(line).toMatch(/=$/)
  })

  it('contains no placeholder password anywhere in docker/', () => {
    for (const text of [compose, envExample, caddyfile]) {
      expect(text.toLowerCase()).not.toContain('changeme')
      expect(text.toLowerCase()).not.toContain('change_me')
    }
  })
})

describe('docker/proxy/Caddyfile', () => {
  it('writes each handle block on several lines', () => {
    // `handle /x { reverse_proxy … }` on one line does not parse (caddy validate: "Unexpected next token after '{'").
    expect(caddyfile).not.toMatch(/^\s*handle[^\n]*\{[^\n]*\}/m)
  })

  it('sends /setup to the admin app with a 308 before any handler', () => {
    const redirect = caddyfile.indexOf('redir @setup /admin{uri} 308')
    expect(redirect).toBeGreaterThan(-1)
    expect(redirect).toBeLessThan(caddyfile.indexOf('handle /api/*'))
  })

  it('keeps TLS out of the stack', () => {
    expect(caddyfile).toContain('auto_https off')
    expect(caddyfile).toContain('admin off')
  })
})
