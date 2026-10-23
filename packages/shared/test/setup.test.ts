import { describe, expect, it } from 'vitest'

import {
  RecoveryKey,
  SETUP_TOKEN_HEADER,
  SetupEmail,
  SetupEmailSaved,
  SetupInstallRequest,
  SetupSite,
  SetupStatusResponse,
  SetupToken,
} from '../src/index.ts'

const SITE = {
  locale: 'nb',
  title: 'Min blogg',
  timezone: 'Europe/Oslo',
  adminEmail: 'a@example.test',
  blogPublic: true,
}
const ADMIN = { username: 'tor', email: 'tor@example.test', password: 'a long and fine password' }

describe('the setup wizard schemas', () => {
  it('takes the token in a header that is lower case, so a client and a test spell it the same way', () => {
    expect(SETUP_TOKEN_HEADER).toBe('x-setup-token')
    expect(SetupToken.safeParse('A'.repeat(43)).success).toBe(true)
    for (const bad of ['', 'short', 'a b', 'A'.repeat(129), 'ø'.repeat(43)]) {
      expect(SetupToken.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('status says only whether the site is installed and the next step', () => {
    expect(Object.keys(SetupStatusResponse.shape).sort()).toEqual(['installed', 'nextStep'])
    expect(SetupStatusResponse.parse({ installed: true, nextStep: null })).toEqual({ installed: true, nextStep: null })
    expect(SetupStatusResponse.safeParse({ installed: false, nextStep: 'nowhere' }).success).toBe(false)
  })

  it('the site step trims the title and accepts only a time zone the runtime knows', () => {
    expect(SetupSite.parse({ ...SITE, title: '  Min blogg  ' }).title).toBe('Min blogg')
    expect(SetupSite.parse({ ...SITE, timezone: 'UTC' }).timezone).toBe('UTC')
    for (const bad of [
      { ...SITE, timezone: 'Mars/Olympus' },
      { ...SITE, timezone: '' },
      { ...SITE, title: '   ' },
      { ...SITE, title: 'a\nb' },
      { ...SITE, locale: 'nb_NO' },
      { ...SITE, blogPublic: 'yes' },
      { ...SITE, extra: 1 },
    ]) {
      expect(SetupSite.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('the e-mail step keeps header-breaking text out of the user name and the sender name', () => {
    const base = { host: 'smtp.example.test', secure: 'starttls', fromAddress: 'noreply@example.test' }
    expect(SetupEmail.safeParse({ ...base, username: 'mailer', password: 'pw', fromName: 'Min blogg' }).success).toBe(
      true,
    )
    expect(SetupEmail.safeParse({ ...base, username: '', fromName: '' }).success).toBe(true)
    expect(SetupEmail.safeParse({ ...base, username: 'a\r\nBcc: x@example.test' }).success).toBe(false)
    expect(SetupEmail.safeParse({ ...base, fromName: 'a\nb' }).success).toBe(false)
    expect(SetupEmail.safeParse({ ...base, port: 0 }).success).toBe(false)
    expect(SetupEmail.safeParse({ ...base, secure: 'ssl' }).success).toBe(false)
  })

  it('what is saved of the e-mail step has no password field, only whether one is set', () => {
    expect(Object.keys(SetupEmailSaved.shape).sort()).toEqual([
      'fromAddress',
      'fromName',
      'host',
      'port',
      'secure',
      'smtpPasswordSet',
      'username',
    ])
  })

  it('the install needs confirmed: true and a recovery key, and an administrator by the usual rules', () => {
    const body = { admin: ADMIN, recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789', confirmed: true }
    expect(SetupInstallRequest.safeParse(body).success).toBe(true)
    for (const bad of [
      { ...body, confirmed: false },
      { ...body, confirmed: 'true' },
      { admin: ADMIN, confirmed: true },
      { ...body, admin: { ...ADMIN, password: 'short' } },
      { ...body, admin: { ...ADMIN, role: 'administrator' } },
      { ...body, extra: 1 },
    ]) {
      expect(SetupInstallRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('a recovery key is eight groups of four from the alphabet without I, L, O and U', () => {
    expect(RecoveryKey.safeParse('ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789').success).toBe(true)
    for (const bad of [
      'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345',
      'abcd-efgh-jkmn-pqrs-tvwx-yz01-2345-6789',
      'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-678O',
    ]) {
      expect(RecoveryKey.safeParse(bad).success, bad).toBe(false)
    }
  })
})
