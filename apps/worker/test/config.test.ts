import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig, loadHealthcheckConfig } from '../src/config.ts'

const ENCRYPTION_KEY = 'ab'.repeat(16) + 'cd'.repeat(16)
const OLD_KEY = '0123456789abcdef'.repeat(4)

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://toascribe_app:s3cret-value@postgres:5432/toascribe',
  PUBLIC_ORIGIN: 'https://example.com',
  TOASCRIBE_ENCRYPTION_KEY: ENCRYPTION_KEY,
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
  it('parses a valid environment and applies the defaults; PORT is not needed', () => {
    const config = loadConfig(VALID)
    expect(config).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: VALID.DATABASE_URL,
      PUBLIC_ORIGIN: VALID.PUBLIC_ORIGIN,
      LOG_LEVEL: 'info',
      WORKER_HEARTBEAT_FILE: '/tmp/toascribe-worker.heartbeat',
      TOASCRIBE_ENCRYPTION_KEY_VERSION: 1,
      TOASCRIBE_ENCRYPTION_OLD_KEYS: [],
    })
    expect(config.TOASCRIBE_ENCRYPTION_KEY).toHaveLength(32)
    expect(config).not.toHaveProperty('PORT')
  })

  it('names the missing variables', () => {
    expect(configError({}).fields).toEqual(['NODE_ENV', 'DATABASE_URL', 'PUBLIC_ORIGIN', 'TOASCRIBE_ENCRYPTION_KEY'])
  })

  it('has no mail settings of its own: SMTP and the sender are optional defaults', () => {
    const config = loadConfig(VALID)
    for (const name of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'MAIL_FROM_ADDRESS',
      'MAIL_FROM_NAME',
    ] as const) {
      expect(config[name]).toBeUndefined()
    }
  })

  it('reads the SMTP and sender defaults', () => {
    expect(
      loadConfig({
        ...VALID,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '2525',
        SMTP_SECURE: 'tls',
        SMTP_USERNAME: 'mailer',
        SMTP_PASSWORD: 'p@ss word',
        MAIL_FROM_ADDRESS: 'noreply@example.com',
        MAIL_FROM_NAME: 'Bloggen',
      }),
    ).toMatchObject({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 2525,
      SMTP_SECURE: 'tls',
      SMTP_USERNAME: 'mailer',
      SMTP_PASSWORD: 'p@ss word',
      MAIL_FROM_ADDRESS: 'noreply@example.com',
      MAIL_FROM_NAME: 'Bloggen',
    })
  })

  it('treats an empty value as not set, as docker compose passes `${VAR:-}`', () => {
    const config = loadConfig({
      ...VALID,
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_SECURE: '',
      SMTP_USERNAME: '',
      SMTP_PASSWORD: '',
      MAIL_FROM_ADDRESS: '',
      MAIL_FROM_NAME: '',
    })
    expect(config.SMTP_HOST).toBeUndefined()
    expect(config.SMTP_PORT).toBeUndefined()
    expect(config.SMTP_SECURE).toBeUndefined()
    expect(config.MAIL_FROM_ADDRESS).toBeUndefined()
  })

  it.each([
    ['SMTP_HOST', 'not a host!'],
    ['SMTP_PORT', '70000'],
    ['SMTP_PORT', 'abc'],
    ['SMTP_SECURE', 'ssl'],
    ['SMTP_USERNAME', 'a\r\nb'],
    ['MAIL_FROM_ADDRESS', 'not-an-address'],
    ['MAIL_FROM_NAME', 'a\r\nBcc: x@example.com'],
  ])('refuses %s=%j, naming the variable and never printing the value', (name, value) => {
    const error = configError({ ...VALID, [name]: value })
    expect(error.fields).toEqual([name])
    expect(error.message).not.toContain(value)
  })

  it('refuses a bad key without printing it, and a version used twice', () => {
    const bad = configError({ ...VALID, TOASCRIBE_ENCRYPTION_KEY: 'too-short-sekret' })
    expect(bad.fields).toEqual(['TOASCRIBE_ENCRYPTION_KEY'])
    expect(bad.message).not.toContain('sekret')
    const twice = configError({ ...VALID, TOASCRIBE_ENCRYPTION_OLD_KEYS: `v1:${OLD_KEY}` })
    expect(twice.fields).toEqual(['TOASCRIBE_ENCRYPTION_OLD_KEYS'])
    expect(twice.message).toContain('appears twice')
  })

  it('reads the older keys and the key version', () => {
    const config = loadConfig({
      ...VALID,
      TOASCRIBE_ENCRYPTION_KEY_VERSION: '2',
      TOASCRIBE_ENCRYPTION_OLD_KEYS: `v1:${OLD_KEY}`,
    })
    expect(config.TOASCRIBE_ENCRYPTION_KEY_VERSION).toBe(2)
    expect(config.TOASCRIBE_ENCRYPTION_OLD_KEYS.map((entry) => entry.version)).toEqual([1])
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
