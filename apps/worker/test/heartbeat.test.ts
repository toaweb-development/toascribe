import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_AGE_MS,
  isHeartbeatFresh,
  removeHeartbeat,
  writeHeartbeat,
} from '../src/lib/heartbeat.ts'

describe('heartbeat file', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'toascribe-heartbeat-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('tolerates three missed beats', () => {
    expect(HEARTBEAT_MAX_AGE_MS).toBeGreaterThanOrEqual(3 * HEARTBEAT_INTERVAL_MS)
  })

  it('is fresh right after a write and gone after a remove', async () => {
    const file = join(dir, 'fresh')
    expect(await isHeartbeatFresh(file)).toBe(false) // missing
    await writeHeartbeat(file)
    expect(await isHeartbeatFresh(file)).toBe(true)
    await removeHeartbeat(file)
    expect(await isHeartbeatFresh(file)).toBe(false)
    await removeHeartbeat(file) // removing a missing file is not an error
  })

  it('is stale once older than the maximum age', async () => {
    const file = join(dir, 'stale')
    await writeFile(file, 'x')
    const old = new Date(Date.now() - HEARTBEAT_MAX_AGE_MS - 5000)
    await utimes(file, old, old)
    expect(await isHeartbeatFresh(file)).toBe(false)
    const recent = new Date(Date.now() - HEARTBEAT_MAX_AGE_MS + 20_000)
    await utimes(file, recent, recent)
    expect(await isHeartbeatFresh(file)).toBe(true)
  })
})
