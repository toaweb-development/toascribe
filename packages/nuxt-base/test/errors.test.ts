import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { describeApiError, describeWait } from '../app/lib/api/error-message.ts'
import type { Translate } from '../app/lib/api/error-message.ts'
import { ApiRequestError, parseRetryAfter, toApiRequestError } from '../app/lib/api/errors.ts'

/** A translator that shows the key and the values, so a test sees which message was asked for. */
const t: Translate = (key, named) => (named === undefined ? key : `${key} ${JSON.stringify(named)}`)

describe('toApiRequestError', () => {
  it('reads the API error body, the status and Retry-After from an ofetch error', () => {
    const error = toApiRequestError({
      status: 403,
      data: { error: { code: 'invalid_code', message: 'Wrong', requestId: 'r1' } },
      response: { headers: { get: (name: string) => (name === 'retry-after' ? '12' : null) } },
    })
    expect(error).toMatchObject({ status: 403, code: 'invalid_code', requestId: 'r1', retryAfterSeconds: 12 })
  })

  it('gives `unreadable` for an answer that is not the API error format (a proxy page)', () => {
    expect(toApiRequestError({ status: 502, data: '<html>bad gateway</html>' })).toMatchObject({
      status: 502,
      code: 'unreadable',
    })
    expect(toApiRequestError({ status: 500, data: { error: { code: '' } } })).toMatchObject({ code: 'unreadable' })
  })

  it('gives `network` for no answer, and `timeout` for an aborted request', () => {
    expect(toApiRequestError(new TypeError('fetch failed'))).toMatchObject({ code: 'network', status: undefined })
    expect(toApiRequestError({ cause: { name: 'TimeoutError' } })).toMatchObject({ code: 'timeout' })
    expect(toApiRequestError({ cause: { name: 'AbortError' } })).toMatchObject({ code: 'timeout' })
    expect(toApiRequestError('boom')).toMatchObject({ code: 'network' })
  })

  it('leaves an ApiRequestError as it is', () => {
    const own = new ApiRequestError({ code: 'x' })
    expect(toApiRequestError(own)).toBe(own)
  })
})

describe('parseRetryAfter', () => {
  it.each([
    ['30', 30],
    [' 5 ', 5],
    ['0', 0],
  ])('reads %j as %d seconds', (value, seconds) => {
    expect(parseRetryAfter(value)).toBe(seconds)
  })

  it.each([null, undefined, '', '-1', 'Wed, 21 Oct 2026 07:28:00 GMT', '1.5', '99999999999'])('ignores %j', (value) => {
    expect(parseRetryAfter(value)).toBeUndefined()
  })
})

describe('describeWait', () => {
  it.each([
    [1, 'error.wait.seconds 1'],
    [45, 'error.wait.seconds 45'],
    [90, 'error.wait.minutes 2'],
    [1200, 'error.wait.minutes 20'],
    [5400, 'error.wait.hours 2'],
    [86_400, 'error.wait.hours 24'],
  ])('%d seconds is shown by %s', (seconds, expected) => {
    expect(describeWait(seconds, t)).toBe(expected)
  })

  it('never says zero', () => {
    expect(describeWait(0, t)).toBe('error.wait.seconds 1')
  })
})

describe('describeApiError', () => {
  const asked = (code: string, extra: Partial<ConstructorParameters<typeof ApiRequestError>[0]> = {}) =>
    describeApiError(new ApiRequestError({ code, ...extra }), t)

  it.each([
    ['invalid_credentials', 'error.invalidCredentials'],
    ['unauthorized', 'error.unauthorized'],
    ['mfa_required', 'error.mfaRequired'],
    ['forbidden', 'error.forbidden'],
    ['invalid_password', 'error.invalidPassword'],
    ['password_required', 'error.passwordRequired'],
    ['invalid_code', 'error.invalidCode'],
    ['registration_closed', 'error.registrationClosed'],
    ['registration_unavailable', 'error.registrationUnavailable'],
    ['invalid_token', 'error.invalidToken'],
    ['weak_password', 'error.weakPassword'],
    ['same_email', 'error.sameEmail'],
    ['too_many_factors', 'error.tooManyFactors'],
    ['mfa_required_by_role', 'error.mfaRequiredByRole'],
    ['no_factor', 'error.noFactor'],
    ['email_unavailable', 'error.emailUnavailable'],
    ['origin_invalid', 'error.originInvalid'],
    ['validation_error', 'error.validation'],
    ['mfa_not_pending', 'error.mfaFinished'],
    ['enrolment_finished', 'error.mfaFinished'],
    ['enrolment_unreadable', 'error.enrolmentUnreadable'],
    ['network', 'error.network'],
    ['timeout', 'error.network'],
  ])('maps %s to %s', (code, key) => {
    expect(asked(code)).toBe(key)
  })

  it('shows the wait for a 429 with Retry-After, and a plain message without it', () => {
    expect(asked('too_many_requests', { retryAfterSeconds: 1200 })).toBe(
      'error.tooManyRequestsIn {"wait":"error.wait.minutes 20"}',
    )
    expect(asked('too_many_requests')).toBe('error.tooManyRequests')
  })

  it('never shows the API message, and gives the request id for what it cannot explain', () => {
    expect(asked('something_new', { message: 'SELECT * FROM account' })).toBe('error.server')
    expect(asked('something_new', { requestId: 'r-9' })).toBe('error.serverWithReference {"id":"r-9"}')
  })

  it('has a message for something that is no ApiRequestError at all', () => {
    expect(describeApiError(new Error('x'), t)).toBe('error.unknown')
    expect(describeApiError(undefined, t)).toBe('error.unknown')
  })

  it('says the same for a wrong password and an unknown account (K-004)', () => {
    // Both are `invalid_credentials` to the API; the screen has one message for the code and no other path to a different one.
    expect(asked('invalid_credentials', { status: 401 })).toBe(
      asked('invalid_credentials', { status: 401, message: 'other' }),
    )
  })
})

describe('the wait messages in nb.json', () => {
  const messages = JSON.parse(readFileSync(new URL('../i18n/locales/nb.json', import.meta.url), 'utf8')) as {
    error: { wait: Record<string, string>; tooManyRequestsIn: string; tooManyRequests: string }
  }

  // vue-i18n picks the first form for exactly one and the second for every other number (bokmål: «1 sekund», «30 sekunder»).
  it.each(['seconds', 'minutes', 'hours'])('has a singular and a plural form for %s', (unit) => {
    const forms = (messages.error.wait[unit] ?? '').split(' | ')
    expect(forms).toHaveLength(2)
    for (const form of forms) {
      expect(form).toMatch(/^\{n\} \S+$/)
    }
  })

  it('reads as a sentence with the wait inside, for a wait of seconds as well as minutes', () => {
    expect(messages.error.tooManyRequestsIn).toBe('For mange forsøk. Prøv igjen om {wait}.')
    expect(messages.error.tooManyRequests).not.toContain('{')
  })
})
