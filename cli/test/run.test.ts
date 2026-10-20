import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { run, USAGE } from '../src/run.ts'
import { readVersion } from '../src/version.ts'

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

describe('toa run()', () => {
  it('prints the version for --version and for version', () => {
    expect(run(['--version'], '1.2.3')).toEqual({ code: 0, stdout: '1.2.3\n', stderr: '' })
    expect(run(['version'], '1.2.3')).toEqual({ code: 0, stdout: '1.2.3\n', stderr: '' })
  })

  it('prints usage and exits 2 for no command, an unknown command or extra arguments', () => {
    for (const argv of [[], ['frobnicate'], ['version', 'extra'], ['--help']]) {
      expect(run(argv, '1.2.3')).toEqual({ code: 2, stdout: '', stderr: USAGE })
    }
  })
})

describe('toa entry point', () => {
  it('reports the version from package.json, and exits 2 with usage otherwise', () => {
    const version = readVersion()
    expect(execFileSync(process.execPath, [ENTRY, '--version'], { encoding: 'utf8' })).toBe(`${version}\n`)
    expect(execFileSync(process.execPath, [ENTRY, 'version'], { encoding: 'utf8' })).toBe(`${version}\n`)

    const bad = spawnSync(process.execPath, [ENTRY, 'nope'], { encoding: 'utf8' })
    expect(bad.status).toBe(2)
    expect(bad.stdout).toBe('')
    expect(bad.stderr).toContain('Usage: toa')
  })
})
