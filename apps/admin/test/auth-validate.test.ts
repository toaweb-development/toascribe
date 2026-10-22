import { describe, expect, it } from 'vitest'

import {
  cleanCode,
  validateLogin,
  validateLostPassword,
  validateNewPassword,
  validateRecoveryCode,
  validateRegister,
  validateTotpCode,
} from '../app/utils/auth-validate.ts'

const t = (key: string) => key

describe('validateLogin', () => {
  it('wants a name and a password, and does not judge the password (an old one must still work)', () => {
    expect(validateLogin({ login: 'alice', password: 'x' }, t)).toEqual([])
    expect(validateLogin({}, t).map((error) => error.name)).toEqual(['login', 'password'])
    expect(validateLogin({ login: '   ', password: 'x' }, t).map((error) => error.name)).toEqual(['login'])
    expect(validateLogin({ login: 'a', password: ' ' }, t)).toEqual([]) // a password is not trimmed
  })
})

describe('validateLostPassword', () => {
  it('wants a name or an address', () => {
    expect(validateLostPassword({ login: 'a@b.no' }, t)).toEqual([])
    expect(validateLostPassword({ login: ' ' }, t)).toEqual([
      { name: 'login', message: 'auth.validation.loginRequired' },
    ])
  })
})

describe('validateNewPassword', () => {
  it('wants eight characters, as the API does', () => {
    expect(validateNewPassword({ password: '12345678' }, t)).toEqual([])
    expect(validateNewPassword({ password: '1234567' }, t)).toEqual([
      { name: 'password', message: 'auth.validation.newPassword' },
    ])
    expect(validateNewPassword({}, t)).toHaveLength(1)
  })
})

describe('validateRegister', () => {
  it('uses the API schema for the shape of the name and the address', () => {
    expect(validateRegister({ username: 'alice', email: 'alice@example.test' }, t)).toEqual([])
    expect(validateRegister({ username: ' alice ', email: ' alice@example.test ' }, t)).toEqual([])
  })

  it('names each field that is wrong', () => {
    expect(validateRegister({ username: 'ab', email: 'alice@example.test' }, t).map((error) => error.name)).toEqual([
      'username',
    ])
    expect(validateRegister({ username: 'alice', email: 'not an address' }, t).map((error) => error.name)).toEqual([
      'email',
    ])
    expect(validateRegister({ username: 'a b c', email: '' }, t).map((error) => error.name)).toEqual([
      'username',
      'email',
    ])
    expect(validateRegister({ username: '-alice', email: 'a@b.no' }, t).map((error) => error.name)).toEqual([
      'username',
    ])
  })
})

describe('the codes', () => {
  it('accepts six digits, with a space in the middle, and nothing else', () => {
    for (const code of ['123456', '123 456', ' 123456 ']) {
      expect(validateTotpCode({ code }, t)).toEqual([])
    }
    for (const code of ['12345', '1234567', 'abcdef', '', '123-456']) {
      expect(validateTotpCode({ code }, t)).toHaveLength(1)
    }
  })

  it('accepts a recovery code however it is written, once it is long enough', () => {
    for (const code of ['ABCD-EFGH-JKMN-PQRS', 'abcdefghjkmnpqrs', 'ABCD EFGH JKMN PQRS']) {
      expect(validateRecoveryCode({ code }, t)).toEqual([])
    }
    expect(validateRecoveryCode({ code: 'ABC-DEF' }, t)).toHaveLength(1)
    expect(validateRecoveryCode({}, t)).toHaveLength(1)
  })

  it('cleanCode takes the spaces round a code off and keeps the rest', () => {
    expect(cleanCode(' 123 456 ')).toBe('123 456')
  })
})
