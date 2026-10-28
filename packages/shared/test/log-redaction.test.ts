// The fixed list of K-297: hidden at any depth, whatever the case or separators of the name; e-mail addresses, credentials and the
// user of an address hidden in every string; everything else left as it was.
import { describe, expect, it } from 'vitest'

import {
  LOG_REDACTED,
  REDACTED_LOG_FIELDS,
  consoleArgsForLog,
  isRedactedField,
  scrubForLog,
  scrubLogText,
} from '../src/log-redaction.ts'

describe('scrubForLog', () => {
  it('hides every listed field at any depth, and names ending in password, token or secret', () => {
    const logged = scrubForLog({
      a: Object.fromEntries(REDACTED_LOG_FIELDS.map((name) => [name, `verdi-${name}`])),
      b: { c: { 'Set-Cookie': 'sid=x', X_CSRF_Token: 'y', smtpPassword: 'z', resetToken: 't', clientSecret: 's' } },
      list: [{ password: 'p' }],
      kept: { username: 'ola', status: 200, key: 'blogname' },
    })
    const text = JSON.stringify(logged)
    for (const name of REDACTED_LOG_FIELDS) expect(text).not.toContain(`verdi-${name}`)
    for (const secret of ['sid=x', '"y"', '"z"', '"t"', '"s"', '"p"']) expect(text).not.toContain(secret)
    expect(logged.kept).toEqual({ username: 'ola', status: 200, key: 'blogname' })
  })

  it('scrubs strings and errors, and leaves the input as it was', () => {
    const input = {
      message: 'mail til ola@example.test feilet',
      header: 'Bearer abc.def',
      url: 'postgres://app:hemmelig@db/x',
    }
    const out = scrubForLog(input)
    expect(out).toEqual({
      message: `mail til ${LOG_REDACTED} feilet`,
      header: `Bearer ${LOG_REDACTED}`,
      url: `postgres://${LOG_REDACTED}@db/x`,
    })
    expect(input.header).toBe('Bearer abc.def')
    const err = scrubForLog({ err: Object.assign(new Error('ola@example.test finnes ikke'), { code: '23505' }) })
    expect(JSON.stringify(err)).not.toContain('ola@example.test')
    expect(err.err).toMatchObject({ type: 'Error', code: '23505' })
  })

  it('compares names without case, - or _', () => {
    expect(isRedactedField('Set-Cookie')).toBe(true)
    expect(isRedactedField('PROXY_AUTHORIZATION')).toBe(true)
    // Every secret the configs read from the environment, under its own name.
    for (const name of [
      'TOASCRIBE_ENCRYPTION_KEY',
      'TOASCRIBE_ENCRYPTION_OLD_KEYS',
      'TOASCRIBE_SIGNING_KEY',
      'SMTP_PASSWORD',
      'POSTGRES_PASSWORD',
      'POSTGRES_APP_PASSWORD',
      'POSTGRES_OWNER_PASSWORD',
      'oldKeys',
      'ageIdentity',
      'recoveryKey',
    ]) {
      expect(isRedactedField(name), name).toBe(true)
    }
    expect(isRedactedField('tokenHash')).toBe(true)
    expect(isRedactedField('contentHash')).toBe(false)
    expect(isRedactedField('key')).toBe(false)
    expect(scrubLogText('Basic dXNlcjpwYXNz')).toBe(`Basic ${LOG_REDACTED}`)
  })
})

describe('consoleArgsForLog', () => {
  it("keeps no query string of an address and no stack, as Nitro's «[request error]» line would have them", () => {
    const error = new Error('fetch failed')
    const out = consoleArgsForLog([
      '[request error] [unhandled] [GET] https://site.example/side?action=rp&key=abc123\n',
      error,
    ])
    expect(out[0]).toBe('[request error] [unhandled] [GET] https://site.example/side?[skjult]\n')
    expect(out[1]).toEqual({ name: 'Error', message: 'fetch failed' })
    expect(JSON.stringify(out)).not.toContain('abc123')
    expect(consoleArgsForLog([error], true)[0]).toHaveProperty('stack')
  })
})
