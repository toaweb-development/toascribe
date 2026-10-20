import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig, loadHealthcheckConfig } from '../src/config.ts'

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://toascribe_app:s3cret-value@postgres:5432/toascribe',
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
  it('parses a valid environment and applies the defaults; PORT and PUBLIC_ORIGIN are not needed', () => {
    expect(loadConfig(VALID)).toEqual({
      ...VALID,
      LOG_LEVEL: 'info',
      WORKER_HEARTBEAT_FILE: '/tmp/toascribe-worker.heartbeat',
    })
  })

  it('names the missing variables', () => {
    expect(configError({}).fields).toEqual(['NODE_ENV', 'DATABASE_URL'])
  })

  it('never prints a value, not even a rejected one', () => {
    const message = configError({ ...VALID, DATABASE_URL: 'mysql://root:s3cret-value@db/x', LOG_LEVEL: 'loud' }).message
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('LOG_LEVEL')
    for (const value of ['s3cret-value', 'mysql', 'loud']) {
      expect(message).not.toContain(value)
    }
  })
})

describe('loadHealthcheckConfig', () => {
  it('needs only the heartbeat path, with the same default', () => {
    expect(loadHealthcheckConfig({})).toEqual({ WORKER_HEARTBEAT_FILE: '/tmp/toascribe-worker.heartbeat' })
    expect(loadHealthcheckConfig({ WORKER_HEARTBEAT_FILE: '/run/hb' })).toEqual({ WORKER_HEARTBEAT_FILE: '/run/hb' })
    expect(() => loadHealthcheckConfig({ WORKER_HEARTBEAT_FILE: '' })).toThrow(ConfigError)
  })
})
