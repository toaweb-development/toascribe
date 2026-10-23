import { describe, expect, it } from 'vitest'

import { WEAK_PASSWORD_MESSAGE, isTooObvious } from '../src/policy.ts'

const ACCOUNT = { username: 'Anna.Berg', email: 'Anna.Berg@Example.Test' }

describe('isTooObvious', () => {
  it.each([
    ['the username', 'Anna.Berg'],
    ['the username in other case', 'ANNA.BERG'],
    ['the username in lower case', 'anna.berg'],
    ['the e-mail address', 'Anna.Berg@Example.Test'],
    ['the e-mail address in lower case', 'anna.berg@example.test'],
    ['the e-mail address in upper case', 'ANNA.BERG@EXAMPLE.TEST'],
  ])('refuses %s', (_name, password) => {
    expect(isTooObvious(password, ACCOUNT)).toBe(true)
  })

  it.each([
    ['a different password', 'a long and fine password'],
    ['the username with something added', 'Anna.Berg1'],
    ['the username with a space around it', ' Anna.Berg '],
    ['the local part of the address', 'Anna.Berg@'],
    ['the empty string', ''],
  ])('allows %s', (_name, password) => {
    expect(isTooObvious(password, ACCOUNT)).toBe(false)
  })

  it('says what to do in a message that names no value', () => {
    expect(WEAK_PASSWORD_MESSAGE).toBe('Choose a password that is not your username or your e-mail address.')
  })
})
