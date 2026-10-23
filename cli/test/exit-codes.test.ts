// The exit-code rule of the whole `toa` CLI: 0 success, 1 an error underway, 2 invalid input or usage (kit.ts, usage.ts, README).
// These paths need no database that answers, so they run without TEST_DATABASE_URL. The paths that need a real database
// (a taken name, an account that is not there, a lost race: 1; a refused password found after the lookup: 2) are pinned in
// user.test.ts and core.test.ts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { run, USAGE } from '../src/run.ts'
import { EXIT_CODES_USAGE } from '../src/usage.ts'

const VERSION = '1.2.3'
const silent = pino({ level: 'silent' })
/** Nothing listens on port 1: the connection is refused at once. */
const DEAD_DATABASE = 'postgres://app:secret-value@127.0.0.1:1/toascribe'
const GOOD_PASSWORD = 'correct-horse-battery-staple-9'

const CREATE = ['user', 'create', '--username', 'anna', '--email', 'anna@example.test', '--role', 'editor'] as const

interface Path {
  readonly name: string
  readonly argv: readonly string[]
  readonly code: 0 | 1 | 2
  readonly env?: Record<string, string>
  readonly stdin?: string
}

const PATHS: readonly Path[] = [
  { name: 'success: version', argv: ['version'], code: 0 },
  { name: 'success: gen-env', argv: ['core', 'gen-env'], code: 0, env: {} },
  { name: 'no command', argv: [], code: 2 },
  { name: 'unknown command', argv: ['frobnicate'], code: 2 },
  { name: 'unknown user subcommand', argv: ['user', 'delete'], code: 2 },
  { name: 'unknown flag', argv: ['core', 'gen-env', '--force'], code: 2, env: {} },
  { name: 'a fixture that is not available', argv: ['dev', 'seed', 'blogg'], code: 2 },
  { name: 'a missing argument', argv: ['user', 'reset-password'], code: 2 },
  { name: 'a malformed value', argv: ['user', 'reset-password', '--email', 'not-an-address'], code: 2 },
  { name: 'a password given on the command line', argv: [...CREATE, '--password', 'x'], code: 2 },
  { name: 'a password the rules refuse (too short)', argv: [...CREATE, '--password-stdin'], code: 2, stdin: 'short\n' },
  {
    name: 'a password equal to the username',
    argv: [...CREATE, '--password-stdin'],
    code: 2,
    stdin: 'anna\n',
  },
  { name: 'is-installed with an argument', argv: ['core', 'is-installed', 'now'], code: 2 },
  {
    name: 'a bad environment: DATABASE_URL missing',
    argv: ['user', 'reset-password', '--username', 'anna'],
    code: 2,
    env: {},
  },
  {
    name: 'a bad environment: PUBLIC_ORIGIN wrong',
    argv: ['core', 'setup-token'],
    code: 2,
    env: { DATABASE_URL: DEAD_DATABASE },
  },
  {
    name: 'a bad environment: no encryption key for --notify',
    argv: [...CREATE, '--notify'],
    code: 2,
    env: { DATABASE_URL: DEAD_DATABASE },
  },
  {
    name: 'a bad environment: NODE_ENV for the dev seed',
    argv: ['dev', 'seed', 'tom'],
    code: 2,
    env: { NODE_ENV: 'production' },
  },
  {
    name: 'a bad environment: dev seed without MIGRATION_DATABASE_URL',
    argv: ['dev', 'seed', 'tom'],
    code: 2,
    env: { NODE_ENV: 'test' },
  },
  {
    name: 'underway: the database does not answer (user create)',
    argv: [...CREATE],
    code: 1,
    env: { DATABASE_URL: DEAD_DATABASE },
    stdin: '',
  },
  {
    name: 'underway: the database does not answer (reset-password)',
    argv: ['user', 'reset-password', '--username', 'anna'],
    code: 1,
    env: { DATABASE_URL: DEAD_DATABASE },
  },
  {
    name: 'underway: the database does not answer (mfa-reset)',
    argv: ['user', 'mfa-reset', '--username', 'anna'],
    code: 1,
    env: { DATABASE_URL: DEAD_DATABASE },
  },
  {
    name: 'is-installed: an error is 2, not 1',
    argv: ['core', 'is-installed'],
    code: 2,
    env: { DATABASE_URL: DEAD_DATABASE },
  },
  {
    name: 'underway: the database does not answer (core install)',
    argv: [
      'core',
      'install',
      '--url',
      'https://cms.example.test',
      '--title',
      'T',
      '--admin-user',
      'tor',
      '--admin-email',
      'tor@example.test',
      '--skip-email',
      '--admin-password-stdin',
    ],
    code: 1,
    env: { DATABASE_URL: DEAD_DATABASE, PUBLIC_ORIGIN: 'https://cms.example.test' },
    stdin: `${GOOD_PASSWORD}\n`,
  },
]

describe('the exit-code rule', () => {
  it.each(PATHS)('$name exits $code', async ({ argv, code, env, stdin }) => {
    const result = await run(argv, VERSION, {
      logger: silent,
      ...(env === undefined ? {} : { env }),
      readStdin: () => Promise.resolve(stdin ?? ''),
    })
    expect(result.code).toBe(code)
    expect(result.stderr).not.toContain('secret-value')
  })

  it('is written in the usage text and in the README', () => {
    expect(USAGE).toContain(EXIT_CODES_USAGE)
    for (const part of [
      'Exit codes:',
      '0   Success',
      '1   An error underway',
      '2   Invalid input or usage',
      'core is-installed',
    ]) {
      expect(EXIT_CODES_USAGE).toContain(part)
    }
    const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')
    expect(readme).toMatch(/Exit codes: `0`\s+success, `1` an error underway/)
    expect(readme).toMatch(/`2` invalid\s+input or usage/)
    expect(readme).toMatch(/`toa core is-installed` is the one\s+exception/)
  })
})
