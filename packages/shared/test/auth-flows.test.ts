import { describe, expect, it } from 'vitest'

import {
  AuthOptionsResponse,
  ChoosePasswordRequest,
  EmailChangeConfirmRequest,
  EmailChangeRequest,
  LostPasswordRequest,
  MfaConfirmRequest,
  MfaVerifyRequest,
  ReauthRequest,
  RegisterRequest,
  TotpCode,
  Username,
} from '../src/index.ts'

const TOKEN = 'rJ3x9Qm2LkP7vN4sT8uYb1CdEfGhIjKlMnOpQrStUvW'

describe('Username', () => {
  it.each(['kari', 'Kari.Nordmann', 'k_n-1', 'a@b.no', 'abc', 'x'.repeat(60)])('accepts %s', (name) => {
    expect(Username.safeParse(name).success).toBe(true)
  })
  it.each(['ab', '', ' kari', 'kari nordmann', '-kari', '.kari', '_kari', 'kari\n', 'kåre', 'x'.repeat(61)])(
    'refuses %j',
    (name) => {
      expect(Username.safeParse(name).success).toBe(false)
    },
  )
})

describe('TotpCode', () => {
  it.each(['123456', '123 456', ' 123456 ', '000000'])('accepts %j', (code) => {
    expect(TotpCode.safeParse(code).success).toBe(true)
  })
  it.each(['12345', '1234567', 'abcdef', '12 3456', '123-456', '', '１２３４５６'])('refuses %j', (code) => {
    expect(TotpCode.safeParse(code).success).toBe(false)
  })
})

describe('MfaVerifyRequest', () => {
  it('takes a code from the app or a recovery code, named by type', () => {
    expect(MfaVerifyRequest.safeParse({ type: 'totp', code: '123456' }).success).toBe(true)
    expect(MfaVerifyRequest.safeParse({ type: 'recovery', code: 'ABCD-EFGH-JKMN-PQRS' }).success).toBe(true)
  })
  it('refuses an unknown type, a missing type, a code of the wrong kind and extra fields', () => {
    for (const body of [
      { type: 'sms', code: '123456' },
      { code: '123456' },
      { type: 'totp', code: 'ABCD-EFGH-JKMN-PQRS' },
      { type: 'totp', code: '123456', remember: true },
      { type: 'recovery', code: 'short' },
    ]) {
      expect(MfaVerifyRequest.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
  })
})

describe('ReauthRequest', () => {
  it('takes the current password and nothing else: a code from the app is not proof', () => {
    expect(ReauthRequest.safeParse({ password: 'x' }).success).toBe(true)
    expect(ReauthRequest.safeParse({ code: '123456' }).success).toBe(false)
    expect(ReauthRequest.safeParse({ password: 'x', code: '123456' }).success).toBe(false)
    expect(ReauthRequest.safeParse({}).success).toBe(false)
  })
})

describe('MfaConfirmRequest', () => {
  it('takes the code, and the password as an option', () => {
    expect(MfaConfirmRequest.safeParse({ code: '123456' }).success).toBe(true)
    expect(MfaConfirmRequest.safeParse({ code: '123456', password: 'x' }).success).toBe(true)
    expect(MfaConfirmRequest.safeParse({ password: 'x' }).success).toBe(false)
    expect(MfaConfirmRequest.safeParse({ code: '123456', password: 'x', extra: 1 }).success).toBe(false)
  })
})

describe('AuthOptionsResponse', () => {
  it('has the site name, which may be empty, the privacy page or null (K-199) and the form token (K-006)', () => {
    const base = { registrationOpen: false, siteName: '', formToken: '1700000000000.abc' }
    expect(AuthOptionsResponse.safeParse({ ...base, privacyPolicyPath: null }).success).toBe(true)
    expect(AuthOptionsResponse.safeParse({ ...base, privacyPolicyPath: '/personvern/' }).success).toBe(true)
    expect(
      AuthOptionsResponse.safeParse({ registrationOpen: false, siteName: '', privacyPolicyPath: null }).success,
    ).toBe(false)
    expect(AuthOptionsResponse.safeParse({ registrationOpen: false, siteName: '' }).success).toBe(false)
    expect(AuthOptionsResponse.safeParse({ registrationOpen: false }).success).toBe(false)
  })
})

describe('the other requests', () => {
  it('LostPasswordRequest wants one line of text', () => {
    expect(LostPasswordRequest.safeParse({ login: 'kari' }).success).toBe(true)
    expect(LostPasswordRequest.safeParse({ login: 'kari@example.no' }).success).toBe(true)
    expect(LostPasswordRequest.safeParse({ login: '' }).success).toBe(false)
    expect(LostPasswordRequest.safeParse({ login: 'a\nb' }).success).toBe(false)
    expect(LostPasswordRequest.safeParse({ login: 'a'.repeat(321) }).success).toBe(false)
  })

  it('ChoosePasswordRequest wants a token-shaped token and a password of at least 8 characters', () => {
    expect(ChoosePasswordRequest.safeParse({ token: TOKEN, password: 'long enough' }).success).toBe(true)
    expect(ChoosePasswordRequest.safeParse({ token: TOKEN, password: 'short' }).success).toBe(false)
    expect(ChoosePasswordRequest.safeParse({ token: 'short', password: 'long enough' }).success).toBe(false)
    expect(ChoosePasswordRequest.safeParse({ token: `${TOKEN}!`, password: 'long enough' }).success).toBe(false)
    expect(ChoosePasswordRequest.safeParse({ token: TOKEN, password: 'long enough', login: 'x' }).success).toBe(false)
  })

  it('RegisterRequest takes a username, an address, the form token and the hidden field, and nothing else', () => {
    const form = { username: 'kari', email: 'kari@example.no', formToken: '1700000000000.abc' }
    expect(RegisterRequest.safeParse(form).success).toBe(true)
    expect(RegisterRequest.safeParse({ ...form, website: '' }).success).toBe(true)
    expect(RegisterRequest.safeParse({ username: 'kari', email: 'kari@example.no' }).success).toBe(false)
    expect(RegisterRequest.safeParse({ ...form, email: 'kari' }).success).toBe(false)
    expect(RegisterRequest.safeParse({ ...form, role: 'administrator' }).success).toBe(false)
  })

  it('EmailChangeRequest and EmailChangeConfirmRequest', () => {
    expect(EmailChangeRequest.safeParse({ newEmail: 'ny@example.no', password: 'x' }).success).toBe(true)
    expect(EmailChangeRequest.safeParse({ newEmail: 'ny@example.no' }).success).toBe(false)
    expect(EmailChangeConfirmRequest.safeParse({ token: TOKEN }).success).toBe(true)
    expect(EmailChangeConfirmRequest.safeParse({ token: 'x' }).success).toBe(false)
  })
})
