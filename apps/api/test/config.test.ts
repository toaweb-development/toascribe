import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig, loadHealthcheckConfig } from '../src/config.ts'

const ENCRYPTION_KEY = 'ab'.repeat(16) + 'cd'.repeat(16)
const SIGNING_KEY = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA' // base64 of 32 bytes

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://toascribe_app:s3cret-value@postgres:5432/toascribe',
  PUBLIC_ORIGIN: 'https://example.com',
  TOASCRIBE_ENCRYPTION_KEY: ENCRYPTION_KEY,
  TOASCRIBE_SIGNING_KEY: SIGNING_KEY,
}

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env)
  } catch (err) {
    if (err instanceof ConfigError) {
      return err
    }
    throw err
  }
  throw new Error('expected loadConfig to throw')
}

describe('loadConfig', () => {
  it('parses a valid environment and applies the defaults', () => {
    const config = loadConfig(VALID)
    expect(config).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: VALID.DATABASE_URL,
      PUBLIC_ORIGIN: VALID.PUBLIC_ORIGIN,
      PORT: 3001,
      LOG_LEVEL: 'info',
      TOASCRIBE_ENCRYPTION_KEY_VERSION: 1,
      TOASCRIBE_ENCRYPTION_OLD_KEYS: [],
    })
    expect(config.TOASCRIBE_ENCRYPTION_KEY).toHaveLength(32)
    expect(config.TOASCRIBE_SIGNING_KEY).toHaveLength(32)
  })

  it('reads TOASCRIBE_TRUSTED_PROXY as text, empty when it is not set, and trims it', () => {
    expect(loadConfig(VALID).TOASCRIBE_TRUSTED_PROXY).toBe('')
    expect(loadConfig({ ...VALID, TOASCRIBE_TRUSTED_PROXY: '' }).TOASCRIBE_TRUSTED_PROXY).toBe('')
    expect(loadConfig({ ...VALID, TOASCRIBE_TRUSTED_PROXY: ' 10.231.97.250 ' }).TOASCRIBE_TRUSTED_PROXY).toBe(
      '10.231.97.250',
    )
  })

  it('coerces PORT and accepts LOG_LEVEL', () => {
    expect(loadConfig({ ...VALID, PORT: '8080', LOG_LEVEL: 'debug' })).toMatchObject({ PORT: 8080, LOG_LEVEL: 'debug' })
  })

  it('names the missing variables and fails fast', () => {
    const err = configError({})
    expect(err.fields).toEqual([
      'NODE_ENV',
      'DATABASE_URL',
      'PUBLIC_ORIGIN',
      'TOASCRIBE_ENCRYPTION_KEY',
      'TOASCRIBE_SIGNING_KEY',
    ])
  })

  it('never prints a value, not even a rejected one', () => {
    const bad = { ...VALID, DATABASE_URL: 'mysql://root:s3cret-value@db/x', PORT: 'not-a-port', LOG_LEVEL: 'loud' }
    const message = configError(bad).message
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('PORT')
    expect(message).toContain('LOG_LEVEL')
    for (const value of ['s3cret-value', 'mysql', 'not-a-port', 'loud']) {
      expect(message).not.toContain(value)
    }
  })

  it('rejects a PORT out of range', () => {
    expect(() => loadConfig({ ...VALID, PORT: '70000' })).toThrow(ConfigError)
  })
})

describe('loadConfig: the keys (K-318)', () => {
  it('reads 32-byte keys in hex or base64', () => {
    const config = loadConfig(VALID)
    expect(config.TOASCRIBE_ENCRYPTION_KEY[0]).toBe(0xab)
    expect(config.TOASCRIBE_SIGNING_KEY).toHaveLength(32)
  })

  it('refuses a key that is too short, not hex or base64, or one repeated byte, naming the variable and not the value', () => {
    for (const bad of ['short-secret-value', 'ab'.repeat(31), 'zz'.repeat(32), '00'.repeat(32)]) {
      for (const name of ['TOASCRIBE_ENCRYPTION_KEY', 'TOASCRIBE_SIGNING_KEY']) {
        const err = configError({ ...VALID, [name]: bad })
        expect(err.fields).toEqual([name])
        expect(err.message).toContain(name)
        expect(err.message).not.toContain(bad)
      }
    }
  })

  it('refuses the same key for both purposes', () => {
    const err = configError({ ...VALID, TOASCRIBE_SIGNING_KEY: ENCRYPTION_KEY })
    expect(err.fields).toEqual(['TOASCRIBE_SIGNING_KEY'])
    expect(err.message).not.toContain(ENCRYPTION_KEY)
  })

  it('takes a key version and older keys for rotation', () => {
    const old = '9f'.repeat(16) + '8e'.repeat(16)
    const config = loadConfig({
      ...VALID,
      TOASCRIBE_ENCRYPTION_KEY_VERSION: '2',
      TOASCRIBE_ENCRYPTION_OLD_KEYS: `v1:${old}`,
    })
    expect(config.TOASCRIBE_ENCRYPTION_KEY_VERSION).toBe(2)
    expect(config.TOASCRIBE_ENCRYPTION_OLD_KEYS).toHaveLength(1)
    expect(config.TOASCRIBE_ENCRYPTION_OLD_KEYS[0]?.version).toBe(1)
    expect(config.TOASCRIBE_ENCRYPTION_OLD_KEYS[0]?.key).toHaveLength(32)
  })

  it('refuses a repeated version, a malformed old-key list and a bad old key, without printing keys', () => {
    const old = '9f'.repeat(16) + '8e'.repeat(16)
    for (const [version, olds] of [
      ['1', `v1:${old}`], // the old key has the version of the current one
      ['2', `v1:${old},v1:${old}`],
      ['2', old], // no v<n>: prefix
      ['2', 'v1:not-a-key-at-all'],
      ['2', 'v0:' + old],
    ] as const) {
      const err = configError({
        ...VALID,
        TOASCRIBE_ENCRYPTION_KEY_VERSION: version,
        TOASCRIBE_ENCRYPTION_OLD_KEYS: olds,
      })
      expect(err.fields).toEqual(['TOASCRIBE_ENCRYPTION_OLD_KEYS'])
      expect(err.message).not.toContain(old)
      expect(err.message).not.toContain('not-a-key-at-all')
    }
    expect(configError({ ...VALID, TOASCRIBE_ENCRYPTION_KEY_VERSION: '0' }).fields).toEqual([
      'TOASCRIBE_ENCRYPTION_KEY_VERSION',
    ])
  })
})

describe('loadHealthcheckConfig', () => {
  it('needs only PORT, with the same default', () => {
    expect(loadHealthcheckConfig({})).toEqual({ PORT: 3001 })
    expect(loadHealthcheckConfig({ PORT: '4000' })).toEqual({ PORT: 4000 })
    expect(() => loadHealthcheckConfig({ PORT: 'x' })).toThrow(ConfigError)
  })
})
