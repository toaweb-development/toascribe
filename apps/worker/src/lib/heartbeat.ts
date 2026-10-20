// The worker has no HTTP port, so its container healthcheck is a file: the worker rewrites it
// every HEARTBEAT_INTERVAL_MS while it is alive and its database answers, and
// `node dist/healthcheck.js` exits 0 only if the file is younger than HEARTBEAT_MAX_AGE_MS.
import { rm, stat, writeFile } from 'node:fs/promises'

export const HEARTBEAT_INTERVAL_MS = 15_000
/** Three missed beats. */
export const HEARTBEAT_MAX_AGE_MS = 45_000

export async function writeHeartbeat(file: string): Promise<void> {
  await writeFile(file, `${new Date().toISOString()}\n`)
}

export async function removeHeartbeat(file: string): Promise<void> {
  await rm(file, { force: true })
}

/** True when the file exists and was modified less than maxAgeMs before `now`. */
export async function isHeartbeatFresh(
  file: string,
  now = Date.now(),
  maxAgeMs = HEARTBEAT_MAX_AGE_MS,
): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(file)
    return now - mtimeMs < maxAgeMs
  } catch {
    return false
  }
}
