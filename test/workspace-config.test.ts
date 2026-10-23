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

/** A Nuxt app or layer. It reads the libraries through an alias in packages/nuxt-base, not through the condition. */
function isNuxt(dir: string): boolean {
  return existsSync(path(`${dir}/nuxt.config.ts`))
}

/** A source file without its `//` comment lines, so a rule can be checked against code and not against the prose. */
function code(relative: string): string {
  return read(relative)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
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

  const withVitest = packageDirs().filter((dir) => existsSync(path(`${dir}/vitest.config.ts`)))

  it('finds the vitest configs, the Nuxt apps and the layer among them', () => {
    expect(withVitest.length).toBeGreaterThanOrEqual(10)
    expect(withVitest).toEqual(expect.arrayContaining(['apps/site', 'apps/admin', 'packages/nuxt-base']))
  })

  it.each(withVitest)('%s lets Vitest resolve it (ssr.resolve.conditions)', (dir) => {
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

describe('the Nuxt apps and layers', () => {
  const nuxtDirs = packageDirs().filter(isNuxt)
  const scriptsOf = (dir: string): Record<string, unknown> => {
    const manifest = json(`${dir}/package.json`)
    if (!isRecord(manifest) || !isRecord(manifest['scripts'])) throw new Error(`${dir} has no scripts`)
    return manifest['scripts']
  }

  it('finds the site, the admin, the theme and the shared layer', () => {
    expect(nuxtDirs.sort()).toEqual(['apps/admin', 'apps/site', 'packages/nuxt-base', 'themes/default'])
  })

  it.each(nuxtDirs)('%s builds, lints, typechecks and tests without building a library first', (dir) => {
    for (const [name, script] of Object.entries(scriptsOf(dir))) {
      expect(String(script), `${dir} script ${name}`).not.toContain('build:deps')
    }
    expect(Object.keys(scriptsOf(dir))).not.toContain('build:deps')
  })

  it.each(nuxtDirs)('%s generates its .nuxt folder on install', (dir) => {
    // An app that extends a layer bundles the layer's files, and the bundler looks for the tsconfig of the folder they are
    // in. Its tsconfig.json points into .nuxt, which a clean checkout does not have until `nuxt prepare` has run.
    expect(scriptsOf(dir)['postinstall'], dir).toBe('nuxt prepare')
  })

  it('reads each library that a Nuxt package depends on from src/, through an alias in the shared layer', () => {
    const layer = code('packages/nuxt-base/nuxt.config.ts')
    const wanted = new Set<string>()
    for (const dir of nuxtDirs) {
      const manifest = json(`${dir}/package.json`)
      if (!isRecord(manifest) || !isRecord(manifest['dependencies'])) continue
      for (const name of Object.keys(manifest['dependencies'])) {
        const folder = name.replace('@toascribe/', 'packages/')
        if (name.startsWith('@toascribe/') && existsSync(path(`${folder}/src/index.ts`))) wanted.add(name)
      }
    }
    expect([...wanted]).toContain('@toascribe/shared')
    for (const name of wanted) {
      expect(layer, `alias for ${name}`).toContain(`'${name}': fileURLToPath(`)
    }
  })

  it.each(nuxtDirs)('%s does not set the "source" condition for TypeScript or Vite', (dir) => {
    // Other packages (the @internationalized/date of Nuxt UI) export a "source" condition too. Set for TypeScript or
    // Vite, it would make them check and bundle those packages' .ts files with our options.
    expect(code(`${dir}/nuxt.config.ts`)).not.toMatch(/customConditions|conditions:\s*\[/)
  })

  it('leaves no workspace concurrency limit, because no build writes into a dist/ that another reads', () => {
    expect(read('pnpm-workspace.yaml')).not.toMatch(/^workspaceConcurrency:/m)
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
    expect(String(scripts['test'])).toContain('pnpm -r --workspace-concurrency=1 test')
    expect(String(scripts['test'])).toContain('--project root')
    expect(String(scripts['build'])).toContain('pnpm -r build')
  })

  it('runs the package tests one at a time, because their database tests share one server-wide role lock', () => {
    // Lint, typecheck and build stay parallel. In parallel the last package in the lock queue waits past its hookTimeout.
    expect(String(scripts['test'])).toMatch(/^pnpm -r --workspace-concurrency=1 test /)
    for (const name of ['lint', 'typecheck', 'build']) {
      expect(String(scripts[name]), name).not.toContain('workspace-concurrency')
    }
  })

  it('is what CI runs', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^\s+run: pnpm check$/m)
  })
})
