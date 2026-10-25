// `smtp_verified_at` has one writer (M0.5, Tor): `markEmailVerified` in packages/install, which the worker calls after it has sent
// a test mail. The one other write is the wizard's `saveEmail` in the same package, which clears the field when the settings
// change. No other source file may mention the key, so a second writer (an api service, a settings page, the cli) fails here and
// has to be argued for.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', 'test', 'e2e', '.git', 'docs'])
const SOURCE_FILE = /\.(ts|vue|js|mjs|sql)$/

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sources(full, out)
    } else if (SOURCE_FILE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** The code of a file: whole-line comments (`//`, `/*`, ` *`) left out, so a sentence about the field is not a use of it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

function rel(file: string): string {
  return relative(ROOT, file)
}

const ALL = ['apps', 'packages', 'cli', 'themes'].flatMap((dir) => sources(join(ROOT, dir)))

/** The files that name the key, and why. Reading it is fine; a write is only in packages/install/src. */
const MAY_NAME_THE_KEY: Readonly<Record<string, string>> = {
  'packages/shared/src/settings.ts': 'the schema, the default and READ_ONLY_SETTING_KEYS',
  'apps/api/src/services/notices.ts': 'reads it for the dashboard notice',
  'packages/install/src/email-verified.ts': 'the one writer',
  'packages/install/src/service.ts': 'reads it for the wizard step; saveEmail clears it',
}

describe('smtp_verified_at has one writer', () => {
  it('is named only by the files that read it, and by the install package that writes it', () => {
    const naming = ALL.filter((file) => code(file).includes('smtp_verified_at')).map(rel)
    expect(naming.sort()).toEqual(Object.keys(MAY_NAME_THE_KEY).sort())
  })

  it('is written in packages/install/src only: the timestamp by markEmailVerified, a clearing by saveEmail', () => {
    const writer = readFileSync(join(ROOT, 'packages/install/src/email-verified.ts'), 'utf8')
    expect(writer.match(/\['smtp_verified_at', /g)).toHaveLength(1)
    const service = readFileSync(join(ROOT, 'packages/install/src/service.ts'), 'utf8')
    expect(service.match(/\['smtp_verified_at', null\]/g)).toHaveLength(1)
    expect(service.match(/\['smtp_verified_at', (?!null\])/g)).toBeNull()
  })

  // A write can take any form (`writeSetting(tx, 'smtp_verified_at', …)`, an object, an SQL string), so the count of every use of
  // the key in each file that may name it is pinned: one more use anywhere fails here and has to be explained.
  it('is used exactly as often as the reads and the two writes need, in each file that may name it', () => {
    const uses = (file: string) => code(join(ROOT, file)).match(/smtp_verified_at/g)?.length ?? 0
    expect(Object.fromEntries(Object.keys(MAY_NAME_THE_KEY).map((file) => [file, uses(file)]))).toEqual({
      // the schema, the default, READ_ONLY_SETTING_KEYS
      'packages/shared/src/settings.ts': 3,
      // pick, destructure, the null check
      'apps/api/src/services/notices.ts': 3,
      // the timestamp
      'packages/install/src/email-verified.ts': 1,
      // the wizard step's read (destructure, pick, the check) and saveEmail's clearing
      'packages/install/src/service.ts': 4,
    })
  })

  it('is marked by the worker only: nothing else calls markEmailVerified', () => {
    const callers = ALL.filter((file) => /\bmarkEmailVerified\b/.test(code(file)))
      .map(rel)
      .filter((file) => !file.startsWith('packages/install/src/'))
    expect(callers).toEqual(['apps/worker/src/jobs/email.ts'])
  })
})
