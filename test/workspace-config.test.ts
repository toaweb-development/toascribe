// The workspace's wiring that a build does not catch until someone is bitten: the "source" export condition that lets
// lint, typecheck and tests read the libraries from src/, and the places that must not ask Node for it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)

function path(relative: string): string {
  return fileURLToPath(new URL(relative, ROOT))
}

function read(relative: string): string {
  return readFileSync(path(relative), 'utf8')
}

function json(relative: string): unknown {
  return JSON.parse(read(relative))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The folders that hold a workspace package, relative to the root: apps/*, packages/*, themes/*, cli. */
function packageDirs(): string[] {
  const dirs = ['cli']
  for (const group of ['apps', 'packages', 'themes']) {
    for (const entry of readdirSync(path(`${group}/`))) {
      if (existsSync(path(`${group}/${entry}/package.json`))) dirs.push(`${group}/${entry}`)
    }
  }
  return dirs.filter((dir) => existsSync(path(`${dir}/package.json`)))
}

/** A Nuxt app or layer: it is built by Nuxt and reads the libraries through dist/ until it sets the condition itself. */
function isNuxt(dir: string): boolean {
  return existsSync(path(`${dir}/nuxt.config.ts`))
}

describe('the "source" export condition', () => {
  it('is set as a custom condition in the shared tsconfig base', () => {
    expect(read('packages/tsconfig/tsconfig.base.json')).toMatch(/"customConditions":\s*\["source"\]/)
  })

  const libraries = packageDirs().filter((dir) => {
    const manifest = json(`${dir}/package.json`)
    return isRecord(manifest) && isRecord(manifest['exports']) && existsSync(path(`${dir}/src/index.ts`))
  })

  it('finds the libraries', () => {
    expect(libraries.length).toBeGreaterThanOrEqual(4)
  })

  it.each(libraries)('%s lists source first in every export, with types before default', (dir) => {
    const manifest = json(`${dir}/package.json`)
    if (!isRecord(manifest) || !isRecord(manifest['exports'])) throw new Error(`${dir} has no exports`)
    for (const [entry, conditions] of Object.entries(manifest['exports'])) {
      // The tsconfig package exports plain JSON files, not code.
      if (!isRecord(conditions)) continue
      const keys = Object.keys(conditions)
      expect(keys.slice(0, 3), `${dir} exports ${entry}`).toEqual(['source', 'types', 'default'])
      const source = conditions['source']
      expect(typeof source === 'string' && existsSync(path(`${dir}/${source}`)), `${dir} source target exists`).toBe(
        true,
      )
    }
  })

  const plain = packageDirs().filter((dir) => !isNuxt(dir) && existsSync(path(`${dir}/vitest.config.ts`)))

  it('finds the vitest configs of the plain packages', () => {
    expect(plain.length).toBeGreaterThanOrEqual(8)
  })

  it.each(plain)('%s lets Vitest resolve it (ssr.resolve.conditions)', (dir) => {
    // test.projects do not inherit this from the root config, and resolve.conditions alone does not reach Node tests.
    expect(read(`${dir}/vitest.config.ts`)).toMatch(/ssr:\s*\{\s*resolve:\s*\{\s*conditions:\s*\['source'\]/)
  })

  it('is never passed to Node by an image, a script or the environment', () => {
    // Node ignores the condition, which is right: the images run dist/. `--conditions=source` would load src/ there.
    const files = [
      'package.json',
      ...packageDirs().map((dir) => `${dir}/package.json`),
      'docker/api/Dockerfile',
      'docker/nuxt/Dockerfile',
      'docker/proxy/Dockerfile',
      'docker/postgres/Dockerfile',
      'docker/compose.yaml',
      'docker/compose.build.yaml',
      'docker/.env.example',
    ]
    for (const file of files) {
      const text = read(file)
      expect(text, file).not.toMatch(/--conditions|-C\s*source|NODE_OPTIONS/)
    }
  })
})

describe('the root scripts', () => {
  const scripts = (() => {
    const manifest = json('package.json')
    if (!isRecord(manifest) || !isRecord(manifest['scripts'])) throw new Error('package.json has no scripts')
    return manifest['scripts']
  })()

  it('has one `check` that runs every step', () => {
    const check = scripts['check']
    expect(typeof check).toBe('string')
    for (const step of ['format:check', 'lint', 'typecheck', 'test', 'build']) {
      expect(check).toContain(`pnpm ${step}`)
    }
  })

  it('runs each step for every package and for the root files, without --if-present', () => {
    for (const [name, value] of Object.entries(scripts)) {
      expect(String(value), name).not.toContain('--if-present')
    }
    expect(String(scripts['lint'])).toContain('pnpm -r lint')
    expect(String(scripts['lint'])).toContain('eslint ')
    expect(String(scripts['typecheck'])).toContain('pnpm -r typecheck')
    expect(String(scripts['typecheck'])).toContain('tsc --noEmit')
    expect(String(scripts['test'])).toContain('pnpm -r test')
    expect(String(scripts['test'])).toContain('--project root')
    expect(String(scripts['build'])).toContain('pnpm -r build')
  })

  it('is what CI runs', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^\s+run: pnpm check$/m)
  })
})
