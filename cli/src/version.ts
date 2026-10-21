import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The version of this package. package.json mirrors the root package.json, which is the source of
 * truth for the repo (VERSIONING_STANDARD_2026 §3). src/ and dist/ are both one level below the
 * package root, so the same relative path works for `node src/index.ts` and `node dist/index.js`.
 */
export function readVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') {
    return raw.version
  }
  throw new Error('package.json has no version')
}
