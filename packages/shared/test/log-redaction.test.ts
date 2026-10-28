// The fixed list of K-297: hidden at any depth, whatever the case or separators of the name; e-mail addresses, credentials and the
// user of an address hidden in every string; everything else left as it was.
import { describe, expect, it } from 'vitest'

import { LOG_REDACTED, REDACTED_LOG_FIELDS, isRedactedField, scrubForLog, scrubLogText } from '../src/log-redaction.ts'

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
    expect(isRedactedField('tokenHash')).toBe(true)
    expect(isRedactedField('contentHash')).toBe(false)
    expect(isRedactedField('key')).toBe(false)
    expect(scrubLogText('Basic dXNlcjpwYXNz')).toBe(`Basic ${LOG_REDACTED}`)
  })
})
