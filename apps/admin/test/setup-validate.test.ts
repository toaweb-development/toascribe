import { describe, expect, it } from 'vitest'

import {
  timezoneChoices,
  validateSetupAdmin,
  validateSetupEmail,
  validateSetupSite,
  validateSetupTestRecipient,
  validateSetupToken,
} from '../app/utils/setup-validate.ts'

const t = (key: string) => key
const names = (errors: { name: string }[]) => errors.map((error) => error.name)
const ZONES = ['Europe/Oslo', 'UTC']

describe('validateSetupToken', () => {
  it('accepts a code with the spaces and line break a paste brings along', () => {
    expect(validateSetupToken({ token: ` ${'a'.repeat(43)}\n` }, t)).toEqual([])
  })
  it.each(['', 'short', 'has a space inside it which no code has at all'])('refuses %j', (token) => {
    expect(names(validateSetupToken({ token }, t))).toEqual(['token'])
  })
})

describe('validateSetupSite', () => {
  const good = { title: 'Mitt nettsted', timezone: 'Europe/Oslo', adminEmail: 'meg@example.test' }
  it('accepts a title, a known zone and an address', () => {
    expect(validateSetupSite(good, t, ZONES)).toEqual([])
  })
  it('names each field that is wrong', () => {
    expect(names(validateSetupSite({ title: '  ', timezone: 'Mars/Base', adminEmail: 'no' }, t, ZONES))).toEqual([
      'title',
      'timezone',
      'adminEmail',
    ])
  })
  it('refuses a title with a line break or more than 200 characters', () => {
    expect(names(validateSetupSite({ ...good, title: 'a\nb' }, t, ZONES))).toEqual(['title'])
    expect(names(validateSetupSite({ ...good, title: 'a'.repeat(201) }, t, ZONES))).toEqual(['title'])
  })
})

describe('validateSetupEmail', () => {
  const good = { host: 'smtp.example.test', port: '', fromAddress: 'site@example.test' }
  it('needs a server and a sender, and the port is optional', () => {
    expect(validateSetupEmail(good, t)).toEqual([])
    expect(names(validateSetupEmail({ host: '', port: '', fromAddress: '' }, t))).toEqual(['host', 'fromAddress'])
  })
  it.each(['0', '65536', '25a', '-1', '1.5', '123456'])('refuses the port %j', (port) => {
    expect(names(validateSetupEmail({ ...good, port }, t))).toEqual(['port'])
  })
  it.each(['1', '25', '587', '65535'])('accepts the port %j', (port) => {
    expect(validateSetupEmail({ ...good, port }, t)).toEqual([])
  })
  it('refuses a server with a space or a slash in it (an address, not a URL)', () => {
    expect(names(validateSetupEmail({ ...good, host: 'smtp example' }, t))).toEqual(['host'])
    expect(names(validateSetupEmail({ ...good, host: 'smtp://example.test' }, t))).toEqual(['host'])
  })
})

describe('validateSetupTestRecipient', () => {
  it('needs an address', () => {
    expect(validateSetupTestRecipient({ to: 'a@example.test' }, t)).toEqual([])
    expect(names(validateSetupTestRecipient({ to: '' }, t))).toEqual(['to'])
  })
})

describe('validateSetupAdmin', () => {
  const good = { username: 'tor', email: 'tor@example.test', password: 'a long enough password' }
  it('accepts the same rules as the api', () => {
    expect(validateSetupAdmin(good, t)).toEqual([])
  })
  it('names each field that is wrong', () => {
    expect(names(validateSetupAdmin({ username: 'a b', email: 'no', password: 'short' }, t))).toEqual([
      'username',
      'email',
      'password',
    ])
  })
  it('refuses a password that is the name or the address', () => {
    expect(validateSetupAdmin({ ...good, password: 'Tor@Example.Test' }, t)).toEqual([
      { name: 'password', message: 'setup.validation.passwordSame' },
    ])
    expect(names(validateSetupAdmin({ ...good, username: 'longusername', password: 'LONGUSERNAME' }, t))).toEqual([
      'password',
    ])
  })
})

describe('timezoneChoices', () => {
  it('sorts the zones and always offers Europe/Oslo and UTC', () => {
    expect(timezoneChoices(['Europe/Paris', 'Asia/Tokyo'])).toEqual([
      'Asia/Tokyo',
      'Europe/Oslo',
      'Europe/Paris',
      'UTC',
    ])
    expect(timezoneChoices(undefined)).toEqual(['Europe/Oslo', 'UTC'])
  })
})
