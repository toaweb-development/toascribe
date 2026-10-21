// The root package.json version is the repo's single version; every workspace package.json
// mirrors it (VERSIONING_STANDARD_2026 §3). A release bumps all of them in one commit, and this
// test fails when one is forgotten.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = new URL('../', import.meta.url)

function versionOf(path: string): string {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
    return raw.version
  }
  throw new Error(`${path} has no version`)
}

/** Every package.json the workspace globs match (pnpm-workspace.yaml: apps/*, packages/*, themes/*, cli). */
function workspaceManifests(): string[] {
  const manifests = [fileURLToPath(new URL('cli/package.json', ROOT))]
  for (const group of ['apps', 'packages', 'themes']) {
    let entries: string[]
    try {
      entries = readdirSync(new URL(`${group}/`, ROOT))
    } catch {
      continue // the group does not exist yet
    }
    for (const entry of entries) {
      manifests.push(fileURLToPath(new URL(`${group}/${entry}/package.json`, ROOT)))
    }
  }
  return manifests.filter((path) => {
    try {
      readFileSync(path)
      return true
    } catch {
      return false
    }
  })
}

describe('version mirrors', () => {
  const rootVersion = versionOf(fileURLToPath(new URL('package.json', ROOT)))

  it('finds the workspace packages', () => {
    expect(workspaceManifests().length).toBeGreaterThanOrEqual(7)
  })

  it.each(workspaceManifests())('%s mirrors the root version', (path) => {
    expect(versionOf(path)).toBe(rootVersion)
  })
})

// The workflows take the image tag from package.json (the `images` job writes it to TOASCRIBE_VERSION). A literal
// `toascribe-<name>:<semver>` there would pass until the first version bump and then break the scan.
describe('workflows', () => {
  const dir = fileURLToPath(new URL('.github/workflows/', ROOT))
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))

  it('finds the workflow files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s has no image tag with a literal version', (name) => {
    const text = readFileSync(`${dir}${name}`, 'utf8')
    const literals = text.match(/toascribe-[a-z0-9-]+:\d+\.\d+\.\d+\S*/g) ?? []
    expect(literals).toEqual([])
  })
})
