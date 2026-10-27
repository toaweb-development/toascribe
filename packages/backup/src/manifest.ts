// The manifest of a backup (M1.7): the first entry of every archive, `manifest.json`. It names the toascribe version and the newest
// migration the database had, when it was made, and every other file in the archive with its size and sha256. A restore reads it
// first and checks every file against it before it changes anything.
import { z } from 'zod'

/** A path inside an archive: `database.dump`, `secrets.json`, or `uploads/<the file's key>`; nothing else (see isArchivePath). */
export const ArchivePath = z.string().refine((path) => isArchivePath(path), { message: 'not a path a backup holds' })

export const Manifest = z.strictObject({
  format: z.literal(1),
  /** The toascribe version that made it (root package.json). */
  toascribe: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  /** The newest migration the database had: its journal tag and time. */
  migration: z.strictObject({ tag: z.string().max(200), when: z.int().nonnegative() }),
  createdAt: z.iso.datetime(),
  /** True when `secrets.json` (the encryption and signing keys) is in it: then the whole archive is encrypted with age. */
  secrets: z.boolean(),
  files: z
    .array(
      z.strictObject({ path: ArchivePath, size: z.int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    )
    .max(5_000_000),
})
export type Manifest = z.infer<typeof Manifest>

export const MANIFEST_PATH = 'manifest.json'
export const DATABASE_PATH = 'database.dump'
export const SECRETS_PATH = 'secrets.json'
export const UPLOADS_PREFIX = 'uploads/'

/**
 * Whether a path may stand in an archive: the three fixed names, or `uploads/` and a relative path of plain segments (letters,
 * digits, `.`, `-`, `_`; no `.` or `..` segment, no empty one, no backslash, no control character), at most 400 characters. A
 * restore refuses an archive with any other name before it writes anything.
 */
export function isArchivePath(path: string): boolean {
  if (path === MANIFEST_PATH || path === DATABASE_PATH || path === SECRETS_PATH) return true
  if (!path.startsWith(UPLOADS_PREFIX) || path.length > 400) return false
  const segments = path.slice(UPLOADS_PREFIX.length).split('/')
  return segments.every(
    (segment) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/.test(segment) && segment !== '.' && segment !== '..',
  )
}

/** The archive's file name: `toascribe-<date>-<version>.tar.zst`, and `.age` when it is encrypted. */
export function archiveName(at: Date, version: string, encrypted: boolean): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-')
  return `toascribe-${stamp}-${version}.tar.zst${encrypted ? '.age' : ''}`
}

/** True for a name archiveName makes (what `list`, `prune` and `verify` look at). */
export const ARCHIVE_NAME = /^toascribe-\d{8}-\d{6}Z-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tar\.zst(?:\.age)?$/

/** Compares two versions as semver (major, minor, patch; a pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = '', pre] = value.split('-', 2)
    return { parts: core.split('.').map(Number), pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  if (left.pre === right.pre) return 0
  if (left.pre === undefined) return 1
  if (right.pre === undefined) return -1
  return left.pre < right.pre ? -1 : 1
}
