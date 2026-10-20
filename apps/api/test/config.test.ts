import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig, loadHealthcheckConfig } from '../src/config.ts'

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://toascribe_app:s3cret-value@postgres:5432/toascribe',
  PUBLIC_ORIGIN: 'https://example.com',
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
    expect(loadConfig(VALID)).toEqual({ ...VALID, PORT: 3001, LOG_LEVEL: 'info' })
  })

  it('coerces PORT and accepts LOG_LEVEL', () => {
    expect(loadConfig({ ...VALID, PORT: '8080', LOG_LEVEL: 'debug' })).toMatchObject({ PORT: 8080, LOG_LEVEL: 'debug' })
  })

  it('names the missing variables and fails fast', () => {
    const err = configError({})
    expect(err.fields).toEqual(['NODE_ENV', 'DATABASE_URL', 'PUBLIC_ORIGIN'])
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

describe('loadHealthcheckConfig', () => {
  it('needs only PORT, with the same default', () => {
    expect(loadHealthcheckConfig({})).toEqual({ PORT: 3001 })
    expect(loadHealthcheckConfig({ PORT: '4000' })).toEqual({ PORT: 4000 })
    expect(() => loadHealthcheckConfig({ PORT: 'x' })).toThrow(ConfigError)
  })
})
