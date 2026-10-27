// scripts/release.sh is the release (VERSIONING_STANDARD_2026 §4.1): the template of the standard with toascribe's variables, and
// two more file kinds for the version mirrors (the TOASCRIBE_VERSION default of the compose files and .env.example). This runs its
// own read_version and write_version on a copy of every file it names, so a mirror it would miss or write wrong fails here, not at
// a release. Nothing is committed, tagged or pushed: only the two functions run, in a temporary folder.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const script = readFileSync(join(ROOT, 'scripts/release.sh'), 'utf8')

function variable(name: string): string {
  const match = new RegExp(`^${name}="\\$\\{${name}:?-([^}]*)\\}"`, 'm').exec(script)
  if (match?.[1] === undefined) throw new Error(`${name} is not set in scripts/release.sh`)
  return match[1]
}

/** The files a glob list names, from the repo root, as bash expands them. */
function expand(globs: string): string[] {
  return execFileSync('bash', [
    '-c',
    `cd "$1" && for f in ${globs}; do [ -f "$f" ] && echo "$f"; done; true`,
    '_',
    ROOT,
  ])
    .toString()
    .split('\n')
    .filter((line) => line !== '')
}

describe('scripts/release.sh', () => {
  const work = mkdtempSync(join(tmpdir(), 'toascribe-release-'))
  afterAll(() => {
    rmSync(work, { recursive: true, force: true })
  })

  it('is the standard template with the gate of this repo', () => {
    expect(variable('VERSION_FILE')).toBe('package.json')
    expect(variable('CHECK_CMD')).toBe('pnpm release:check')
    expect(variable('AUDIT_CMD')).toBe('scripts/audit.sh')
    expect(script).toContain('git push --atomic "$REMOTE" main "$tag"')
    expect(script).toContain('git tag -a "$tag" -m "$tag"')
    expect(script).toMatch(/CHANGELOG\.md mangler/)
  })

  it('writes the version into the source and every mirror the tests check', () => {
    const files = ['package.json', ...expand(variable('MIRROR_FILES'))]
    // Every workspace package.json, both compose files and .env.example.
    expect(files).toEqual(
      expect.arrayContaining([
        'cli/package.json',
        'apps/api/package.json',
        'packages/shared/package.json',
        'themes/default/package.json',
        'docker/compose.yaml',
        'docker/compose.build.yaml',
        'docker/.env.example',
      ]),
    )
    for (const file of files) {
      mkdirSync(join(work, dirname(file)), { recursive: true })
      cpSync(join(ROOT, file), join(work, file))
    }
    const functions = [
      /^read_version\(\) \{[\s\S]*?^\}$/m.exec(script)?.[0],
      /^write_version\(\) \{[\s\S]*?^\}$/m.exec(script)?.[0],
    ].join('\n')
    const out = execFileSync(
      'bash',
      [
        '-c',
        `set -euo pipefail; die() { echo "$*" >&2; exit 1; }; ${functions}
         cd "$1"; shift
         for f in "$@"; do write_version "$f" 9.8.7-rc.1; done
         for f in "$@"; do echo "$f=$(read_version "$f")"; done`,
        '_',
        work,
        ...files,
      ],
      { encoding: 'utf8' },
    )
    expect(out.trim().split('\n')).toEqual(files.map((file) => `${file}=9.8.7-rc.1`))
    // Every image line of the compose files, not only the first.
    for (const file of ['docker/compose.yaml', 'docker/compose.build.yaml']) {
      const text = readFileSync(join(work, file), 'utf8')
      const defaults = [...text.matchAll(/TOASCRIBE_VERSION:-([^}]+)\}/g)].map((match) => match[1])
      expect(defaults.length, file).toBeGreaterThan(0)
      expect(new Set(defaults), file).toEqual(new Set(['9.8.7-rc.1']))
    }
  })
})
