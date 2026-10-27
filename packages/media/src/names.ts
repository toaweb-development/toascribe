// Storage keys: `YYYY/MM/<name>-<random>.<ext>` for an original (WordPress' year and month folders, with a random part so a key cannot
// be guessed from a name and two uploads never meet), and the sizes beside it. A key holds only lower-case letters, digits, `-`, `.` and
// `/`, so it is safe in a path and in a URL without encoding.

/** A key as the storage takes it: segments of [a-z0-9._-], separated by `/`, no `..`, no empty segment. */
export const STORAGE_KEY = /^(?!.*\.\.)[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/

/** The readable part of a file name: lower case, ASCII letters and digits with single hyphens, at most 60 characters. */
export function readableName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '')
  const ascii = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/gi, 'ae')
    .replace(/ø/gi, 'o')
    .replace(/å/gi, 'a')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return ascii === '' ? 'file' : ascii
}

/** Eight random hex characters. */
export function randomPart(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The key of an original: `2026/10/blabaer-3f9a1c2d.jpg` (or without the folders when the setting is off). */
export function originalKey(
  fileName: string,
  ext: string,
  at: Date,
  useYearMonth: boolean,
  random = randomPart(),
): string {
  const folder = useYearMonth ? `${String(at.getUTCFullYear())}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/` : ''
  return `${folder}${readableName(fileName)}-${random}.${ext}`
}

/** The key of a generated file beside an original: `<original without ext>-<suffix>.webp`. */
export function derivedKey(original: string, suffix: string, ext = 'webp'): string {
  return `${original.replace(/\.[^./]*$/, '')}-${suffix}.${ext}`
}

/**
 * The key of a size or the `-scaled` copy: `<original without ext>-<version>-<name>.webp`, where the version is new for every run of
 * the worker (`randomPart()`). /uploads/ serves a public file `immutable` for a year, so a key is never used for other pixels: after
 * an edit, a replacement or new sizes every generated file has a new address, and the old ones are removed (they answer 404).
 */
export function versionedKey(original: string, version: string, name: string): string {
  return derivedKey(original, `${version}-${name}`)
}

/**
 * New keys for an original and every file generated beside it (review L-c): a file that goes from public to private moves, so the
 * address a shared cache may hold for a year answers 404. The original's random part is replaced (or one is added), and each
 * generated key keeps its suffix (`-<version>-<size>.webp`, `-e<ms>.webp`) after the new base.
 */
export function movedKeys(original: string, random = randomPart()): (key: string) => string {
  const extension = /\.[^./]*$/.exec(original)?.[0] ?? ''
  const oldBase = original.slice(0, original.length - extension.length)
  const newBase = /-[0-9a-f]{8}$/.test(oldBase) ? `${oldBase.slice(0, -8)}${random}` : `${oldBase}-${random}`
  return (key) => {
    if (key === original) return `${newBase}${extension}`
    if (!key.startsWith(`${oldBase}-`)) throw new Error('not a file of this original')
    return `${newBase}${key.slice(oldBase.length)}`
  }
}

/** The end of a generated key: `-<version>-<WxH|scaled>.webp`, or an edited image's `-e<milliseconds>.webp`. */
export const GENERATED_SUFFIX = /-(?:[0-9a-f]{8}-(?:\d+x\d+|scaled)|e\d{13})\.webp$/
