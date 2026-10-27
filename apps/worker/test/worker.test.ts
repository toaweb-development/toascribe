// The worker against a real PostgreSQL: schema installed by the migrate runner as the owner, the
// worker connecting as the app role. Skips, with a notice, without TEST_DATABASE_URL.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDb } from '@toascribe/db'
import { createKeyRing, parseKeyMaterial } from '@toascribe/shared'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { isHeartbeatFresh } from '../src/lib/heartbeat.ts'
import { startWorker } from '../src/worker.ts'
import { TEST_DATABASE_URL, createTestDatabase, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('worker')

// The files under test import @toascribe/db. Node ignores the "source" export condition on its own,
// so the child processes ask for it and run the libraries from src/ like the rest of the tests (no dist/ needed).
const NODE_ARGS = ['--conditions=source']
const MIGRATE = fileURLToPath(new URL('../../../packages/db/src/migrate.ts', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const HEALTHCHECK = fileURLToPath(new URL('../src/healthcheck.ts', import.meta.url))

const ENCRYPTION_KEY_HEX = 'ab'.repeat(16) + 'cd'.repeat(16)
const PUBLIC_ORIGIN = 'https://cms.example.test'
const keyRing = await createKeyRing({ version: 1, key: parseKeyMaterial(ENCRYPTION_KEY_HEX) })

/** What startWorker needs besides the database. */
const MAIL = { keyRing, publicOrigin: PUBLIC_ORIGIN, mailDefaults: {} } as const

/** The environment of a worker process: the required variables a test does not set itself. */
const REQUIRED_ENV = { PUBLIC_ORIGIN, TOASCRIBE_ENCRYPTION_KEY: ENCRYPTION_KEY_HEX } as const

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function lines() {
  const collected: Record<string, unknown>[] = []
  const logger = pino(
    { level: 'debug' },
    {
      write(chunk: string) {
        const parsed: unknown = JSON.parse(chunk)
        if (typeof parsed === 'object' && parsed !== null) {
          collected.push(Object.fromEntries(Object.entries(parsed)))
        }
      },
    },
  )
  return { logger, collected }
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('worker file-level behaviour (no database)', () => {
  it('the healthcheck fails when there is no heartbeat file', () => {
    const result = spawnSync(process.execPath, [...NODE_ARGS, HEALTHCHECK], {
      env: { ...stringEnv(), WORKER_HEARTBEAT_FILE: join(tmpdir(), 'toascribe-no-such-heartbeat') },
    })
    expect(result.status).toBe(1)
  })

  it('refuses to start with a bad environment, naming the variable and never the value', () => {
    const result = spawnSync(process.execPath, [...NODE_ARGS, ENTRY], {
      env: { ...stringEnv(), ...REQUIRED_ENV, NODE_ENV: 'test', DATABASE_URL: 'not-a-url-sekret' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('DATABASE_URL')
    expect(result.stdout).not.toContain('sekret')
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('worker (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let dir: string
  let heartbeatFile: string
  let child: ChildProcess | undefined

  beforeAll(async () => {
    database = await createTestDatabase()
    dir = await mkdtemp(join(tmpdir(), 'toascribe-worker-test-'))
    heartbeatFile = join(dir, 'heartbeat')
  })

  afterEach(() => {
    child?.kill('SIGKILL')
    child = undefined
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
    await database.drop()
  })

  it('refuses to start before the migration step has run, and cleans up', async () => {
    const { db, pool } = createDb({ connectionString: database.appUrl })
    const { logger } = lines()
    // "not installed" is pg-boss's migrate:false check; with migrate:true the app role would try DDL instead.
    await expect(
      startWorker({
        pool,
        db,
        databaseUrl: database.appUrl,
        logger,
        heartbeatFile,
        uploadsDir: tmpdir(),
        backupsDir: tmpdir(),
        configFile: '/nonexistent/toascribe.toml',
        updateCheck: { serverAllows: false },
        version: '0.0.0',
        ...MAIL,
      }),
    ).rejects.toThrow('pg-boss is not installed')
    expect(await isHeartbeatFresh(heartbeatFile)).toBe(false)
    await pool.end()
  })

  it('exits non-zero as a process when the schema is missing (migration has not run)', () => {
    const proc = spawnSync(process.execPath, [...NODE_ARGS, ENTRY], {
      env: {
        ...stringEnv(),
        ...REQUIRED_ENV,
        NODE_ENV: 'test',
        DATABASE_URL: database.appUrl,
        WORKER_HEARTBEAT_FILE: join(dir, 'never'),
      },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(proc.status).toBe(1)
    expect(proc.stdout).toContain('worker failed to start')
  })

  it('starts and stops against the migrated database', async () => {
    const migrate = spawnSync(process.execPath, [...NODE_ARGS, MIGRATE], {
      env: { ...stringEnv(), MIGRATION_DATABASE_URL: database.ownerUrl },
      encoding: 'utf8',
    })
    expect(migrate.status, migrate.stdout + migrate.stderr).toBe(0)

    const { db, pool } = createDb({ connectionString: database.appUrl })
    const { logger, collected } = lines()
    const worker = await startWorker({
      pool,
      db,
      databaseUrl: database.appUrl,
      logger,
      heartbeatFile,
      uploadsDir: tmpdir(),
      backupsDir: tmpdir(),
      configFile: '/nonexistent/toascribe.toml',
      updateCheck: { serverAllows: false },
      version: '0.0.0',
      ...MAIL,
    })

    expect(collected.some((line) => line['msg'] === 'worker ready')).toBe(true)
    expect(collected.some((line) => line['msg'] === 'jobs registered')).toBe(true)
    expect(await isHeartbeatFresh(heartbeatFile)).toBe(true)
    expect(collected.filter((line) => line['level'] === 50)).toEqual([]) // no error lines

    await worker.stop()
    await worker.stop() // idempotent
    expect(pool.ended).toBe(true)
    expect(await isHeartbeatFresh(heartbeatFile)).toBe(false)
  })

  it('runs as a process: ready, healthy, exits 0 on SIGTERM and is unhealthy afterwards', async () => {
    const file = join(dir, 'process-heartbeat')
    const env = {
      ...stringEnv(),
      ...REQUIRED_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.appUrl,
      LOG_LEVEL: 'info',
      WORKER_HEARTBEAT_FILE: file,
    }
    let output = ''
    const proc = spawn(process.execPath, [...NODE_ARGS, ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    proc.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => {
      proc.once('close', (code) => {
        resolve(code)
      })
    })

    await waitFor(() => output.includes('worker ready'), 'the worker to be ready')
    const healthy = spawnSync(process.execPath, [...NODE_ARGS, HEALTHCHECK], { env })
    expect(healthy.status).toBe(0)

    proc.kill('SIGTERM')
    expect(await exited).toBe(0)
    expect(output).toContain('shutdown complete')
    expect(output).not.toContain(database.appUrl)

    const down = spawnSync(process.execPath, [...NODE_ARGS, HEALTHCHECK], { env })
    expect(down.status).not.toBe(0)
  })
})
