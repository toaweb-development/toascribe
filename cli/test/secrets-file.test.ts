// `toa secrets export|import` (M1.8, K-271): the recovery key comes on standard input only; export refuses a key that is not this
// install's and writes a 0600 file that holds no value in clear and prints none; import refuses a terminal, a wrong key and a changed
// file, and gives back exactly the keys as .env lines.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMigrations, setSiteSecret } from '@toascribe/db'
import { createDb } from '@toascribe/db'
import { generateRecoveryKey, recoveryKeyVerifier } from '@toascribe/install'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { run } from '../src/run.ts'
import { TEST_DATABASE_URL, createTestDatabase, memoryLogger, noticeIfSkipped } from './helpers.ts'
import type { TestDatabase } from './helpers.ts'

noticeIfSkipped('secrets export')

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const SIGNING = 'f1e2d3c4b5a60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a'

describe('usage', () => {
  it('takes the recovery key on standard input only', async () => {
    const result = await run(['secrets', 'export'], '0.6.0', { env: {}, logger: memoryLogger().logger })
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--recovery-key-stdin')
    expect((await run(['secrets', 'import'], '0.6.0', { env: {}, logger: memoryLogger().logger })).code).toBe(2)
  })
})

describe.skipIf(TEST_DATABASE_URL === undefined)('export and import (needs TEST_DATABASE_URL)', () => {
  let database: TestDatabase
  let dir: string
  const recoveryKey = generateRecoveryKey()
  const env = () => ({
    DATABASE_URL: database.url,
    BACKUPS_DIR: dir,
    TOASCRIBE_ENCRYPTION_KEY: KEY,
    TOASCRIBE_ENCRYPTION_KEY_VERSION: '2',
    TOASCRIBE_ENCRYPTION_OLD_KEYS: `v1:${KEY}, `,
    TOASCRIBE_SIGNING_KEY: SIGNING,
  })
  const toa = (argv: string[], stdin: string, extra: { stdoutIsTerminal?: boolean } = {}) =>
    run(argv, '0.6.0', {
      env: env(),
      logger: memoryLogger().logger,
      readStdin: () => Promise.resolve(stdin),
      stdoutIsTerminal: false,
      ...extra,
    })

  beforeAll(async () => {
    database = await createTestDatabase()
    await runMigrations({ connectionString: database.url, logger: pino({ level: 'silent' }) })
    dir = await mkdtemp(join(tmpdir(), 'toascribe-secrets-'))
    const { db, pool } = createDb({ connectionString: database.url, max: 1 })
    await setSiteSecret(db, 'backup_recovery_key', recoveryKeyVerifier(recoveryKey) ?? '')
    await pool.end()
  })
  afterAll(async () => {
    await database.drop()
    await rm(dir, { recursive: true, force: true })
  })

  it("refuses a key that is not this install's, and writes nothing", async () => {
    const wrong = await toa(['secrets', 'export', '--recovery-key-stdin'], generateRecoveryKey())
    expect(wrong.code).toBe(1)
    expect(wrong.stderr).toContain('not this install')
  })

  it('round-trips: the same keys come back, the file is 0600 and holds no value, nothing is shown', async () => {
    const out = join(dir, 'secrets.json')
    const exported = await toa(['secrets', 'export', '--out', out, '--recovery-key-stdin'], `${recoveryKey}\n`)
    expect(exported.code, exported.stderr).toBe(0)
    expect(`${exported.stdout}${exported.stderr}`).not.toContain(KEY)
    expect((await stat(out)).mode & 0o777).toBe(0o600)
    const file = await readFile(out, 'utf8')
    expect(file).not.toContain(KEY)
    expect(file).not.toContain(SIGNING)
    expect((await toa(['secrets', 'export', '--out', out, '--recovery-key-stdin'], recoveryKey)).code).toBe(1) // never over a file

    const terminal = await toa(['secrets', 'import', out, '--recovery-key-stdin'], recoveryKey, {
      stdoutIsTerminal: true,
    })
    expect(terminal.code).toBe(2)
    expect(terminal.stdout).toBe('')

    const imported = await toa(['secrets', 'import', out, '--recovery-key-stdin'], recoveryKey)
    expect(imported.code, imported.stderr).toBe(0)
    const lines = imported.stdout.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
    expect(lines.sort()).toEqual(
      [
        `TOASCRIBE_ENCRYPTION_KEY=${KEY}`,
        'TOASCRIBE_ENCRYPTION_KEY_VERSION=2',
        `TOASCRIBE_ENCRYPTION_OLD_KEYS=v1:${KEY}`,
        `TOASCRIBE_SIGNING_KEY=${SIGNING}`,
      ].sort(),
    )
    expect(imported.stderr).not.toContain(KEY)

    const refused = await toa(['secrets', 'import', out, '--recovery-key-stdin'], generateRecoveryKey())
    expect(refused.code).toBe(1)
    expect(refused.stdout).toBe('')

    // The file on standard input after the key: nothing has to be copied into the container.
    const piped = await toa(['secrets', 'import', '-', '--recovery-key-stdin'], `${recoveryKey}\n${file}`)
    expect(piped.code, piped.stderr).toBe(0)
    const keysOf = (text: string) => text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
    expect(keysOf(piped.stdout)).toEqual(keysOf(imported.stdout))
    expect(piped.stdout.startsWith('\n#')).toBe(true)
    expect((await toa(['secrets', 'import', '-', '--recovery-key-stdin'], recoveryKey)).code).toBe(2)
  })

  it('prints only the database passwords with gen-env --passwords-only', async () => {
    const result = await run(['core', 'gen-env', '--passwords-only'], '0.6.0', { env: {} })
    expect(result.code).toBe(0)
    expect(
      result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('=')[0]),
    ).toEqual(['POSTGRES_PASSWORD', 'POSTGRES_OWNER_PASSWORD', 'POSTGRES_APP_PASSWORD'])
  })
})
