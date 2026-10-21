import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The version this package reports on /api/health. The source of truth is the root package.json;
 * apps/api/package.json mirrors it (VERSIONING_STANDARD_2026 §3, pinned by test/version.test.ts).
 * src/ and dist/ are both one level below the package root, so one relative path serves
 * `node src/index.ts` and `node dist/index.js`.
 */
export function readPackageVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))
  if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
    return raw.version
  }
  throw new Error('package.json has no version')
}
