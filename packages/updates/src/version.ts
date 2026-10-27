// Releases are tagged X.Y.Z (VERSIONING_STANDARD §3), and the images carry the same tag (and `sha-<short>`, `latest`). Only a plain
// X.Y.Z counts as a release here: no prerelease (`-rc.1`), no build suffix, no `latest`.
const RELEASE = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/

/** The three numbers of a release tag, or undefined for anything else. */
export function parseRelease(tag: string): readonly [number, number, number] | undefined {
  const match = RELEASE.exec(tag)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative, zero or positive as `a` is older than, the same as or newer than `b` (both releases). */
export function compareReleases(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** The newest release among the tags, as X.Y.Z, or null when none is a release. */
export function newestRelease(tags: readonly string[]): string | null {
  let best: readonly [number, number, number] | undefined
  for (const tag of tags) {
    const release = parseRelease(tag)
    if (release !== undefined && (best === undefined || compareReleases(release, best) > 0)) best = release
  }
  return best === undefined ? null : best.join('.')
}

/** Whether `latest` is a release newer than `current` (a version that is not a plain release, e.g. `0.7.0-rc.1`, counts by its numbers). */
export function isNewer(latest: string | null, current: string): boolean {
  if (latest === null) return false
  const next = parseRelease(latest)
  const numbers = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current)
  if (next === undefined || numbers === null) return false
  const running = [Number(numbers[1]), Number(numbers[2]), Number(numbers[3])]
  const order = compareReleases(next, running)
  // 0.7.0 is newer than 0.7.0-rc.1.
  return order > 0 || (order === 0 && current.includes('-'))
}
