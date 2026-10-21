import { CORE_SETTINGS, createKeyRing, parseKeyMaterial, SMTP_PASSWORD_AAD } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { recipientDomain, redactText, summarizeError } from '../src/lib/redact.ts'
import { DEFAULT_PORT, MailConfigError, SMTP_TIMEOUTS_MS, resolveSmtp, smtpTransportOptions } from '../src/mail/smtp.ts'
import type { MailSettings, ResolvedSmtp } from '../src/mail/smtp.ts'
import { memoryLogger, testKeyRing } from './harness.ts'

const NOTHING_SET: MailSettings = {
  blogname: CORE_SETTINGS.blogname,
  locale: CORE_SETTINGS.locale,
  mail_from_address: null,
  mail_from_name: null,
  smtp_host: null,
  smtp_port: null,
  smtp_secure: null,
  smtp_username: null,
  smtp_password: null,
}

const ENV = {
  SMTP_HOST: 'smtp.env.example',
  SMTP_PORT: 2525,
  SMTP_SECURE: 'tls',
  SMTP_USERNAME: 'env-user',
  SMTP_PASSWORD: 'env-password',
  MAIL_FROM_ADDRESS: 'env@example.test',
  MAIL_FROM_NAME: 'Env Name',
} as const

describe('resolveSmtp: settings first, then the environment', () => {
  it('uses the environment when every setting is null', async () => {
    expect(await resolveSmtp(NOTHING_SET, ENV, testKeyRing, 'Site')).toEqual({
      host: 'smtp.env.example',
      port: 2525,
      secure: 'tls',
      auth: { user: 'env-user', pass: 'env-password' },
      from: { address: 'env@example.test', name: 'Env Name' },
    })
  })

  it('prefers a setting over the environment, field by field', async () => {
    const sealed = await testKeyRing.encrypt('setting-password', SMTP_PASSWORD_AAD)
    const smtp = await resolveSmtp(
      {
        ...NOTHING_SET,
        smtp_host: 'smtp.setting.example',
        smtp_port: 587,
        smtp_secure: 'starttls',
        smtp_username: 'setting-user',
        smtp_password: sealed,
        mail_from_address: 'setting@example.test',
        mail_from_name: 'Setting Name',
      },
      ENV,
      testKeyRing,
      'Site',
    )
    expect(smtp).toEqual({
      host: 'smtp.setting.example',
      port: 587,
      secure: 'starttls',
      auth: { user: 'setting-user', pass: 'setting-password' },
      from: { address: 'setting@example.test', name: 'Setting Name' },
    })
  })

  it('mixes sources: one setting, the rest from the environment', async () => {
    const smtp = await resolveSmtp({ ...NOTHING_SET, smtp_host: 'only.the.host' }, ENV, testKeyRing, 'Site')
    expect(smtp).toMatchObject({
      host: 'only.the.host',
      port: 2525,
      secure: 'tls',
      from: { address: 'env@example.test' },
    })
  })

  it('names the sender after the site when neither the setting nor the environment gives a name', async () => {
    const smtp = await resolveSmtp(NOTHING_SET, { ...ENV, MAIL_FROM_NAME: undefined }, testKeyRing, 'Bloggen min')
    expect(smtp.from).toEqual({ address: 'env@example.test', name: 'Bloggen min' })
  })

  it.each([
    ['tls', 465],
    ['starttls', 587],
    ['none', 25],
  ] as const)('uses the usual port for %s when no port is given', async (secure, port) => {
    const smtp = await resolveSmtp(
      { ...NOTHING_SET, smtp_host: 'h', smtp_secure: secure, mail_from_address: 'a@example.test' },
      {},
      testKeyRing,
      'Site',
    )
    expect(smtp.port).toBe(port)
    expect(DEFAULT_PORT[secure]).toBe(port)
  })

  it('defaults to STARTTLS, the safe choice, when nothing says otherwise', async () => {
    const smtp = await resolveSmtp(
      { ...NOTHING_SET, smtp_host: 'h', mail_from_address: 'a@example.test' },
      {},
      testKeyRing,
      'Site',
    )
    expect(smtp.secure).toBe('starttls')
  })

  it('sends without a login when no user name is set anywhere', async () => {
    const smtp = await resolveSmtp(
      { ...NOTHING_SET, smtp_host: 'h', mail_from_address: 'a@example.test' },
      {},
      testKeyRing,
      'Site',
    )
    expect(smtp.auth).toBeUndefined()
  })

  it('refuses a missing host or sender, naming the setting and the variable and no value', async () => {
    const noHost = await resolveSmtp(NOTHING_SET, { MAIL_FROM_ADDRESS: 'a@example.test' }, testKeyRing, 'S').catch(
      (e: unknown) => e,
    )
    expect(noHost).toBeInstanceOf(MailConfigError)
    expect((noHost as Error).message).toMatch(/smtp_host.*SMTP_HOST/)
    const noFrom = await resolveSmtp(NOTHING_SET, { SMTP_HOST: 'smtp.example' }, testKeyRing, 'S').catch(
      (e: unknown) => e,
    )
    expect(noFrom).toBeInstanceOf(MailConfigError)
    expect((noFrom as Error).message).toMatch(/mail_from_address.*MAIL_FROM_ADDRESS/)
  })

  it('refuses a user name without a password', async () => {
    const result = await resolveSmtp(
      { ...NOTHING_SET, smtp_host: 'h', mail_from_address: 'a@example.test', smtp_username: 'someone' },
      {},
      testKeyRing,
      'S',
    ).catch((e: unknown) => e)
    expect(result).toBeInstanceOf(MailConfigError)
  })

  it('refuses a password that was encrypted with another key, a field, or by hand, without saying why', async () => {
    const other = await createKeyRing({ version: 1, key: parseKeyMaterial('aa'.repeat(16) + 'bb'.repeat(16)) })
    const foreign = await other.encrypt('hunter2', SMTP_PASSWORD_AAD)
    const wrongField = await testKeyRing.encrypt('hunter2', 'setting:something_else')
    for (const smtp_password of [foreign, wrongField, 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
      const result = await resolveSmtp(
        { ...NOTHING_SET, smtp_host: 'h', mail_from_address: 'a@example.test', smtp_username: 'u', smtp_password },
        {},
        testKeyRing,
        'S',
      ).catch((e: unknown) => e)
      expect(result).toBeInstanceOf(MailConfigError)
      expect((result as Error).message).not.toContain('hunter2')
      expect((result as Error).message).not.toContain(smtp_password)
    }
  })
})

describe('smtpTransportOptions', () => {
  const base: ResolvedSmtp = {
    host: 'smtp.example.test',
    port: 587,
    secure: 'starttls',
    auth: { user: 'u', pass: 'p' },
    from: { address: 'a@example.test', name: 'A' },
  }
  const { logger } = memoryLogger()

  it('starttls requires the upgrade and never falls back to plain text', () => {
    const options = smtpTransportOptions(base, logger)
    expect(options).toMatchObject({ secure: false, requireTLS: true, ignoreTLS: false })
  })

  it('tls connects with TLS from the first byte', () => {
    expect(smtpTransportOptions({ ...base, secure: 'tls', port: 465 }, logger)).toMatchObject({
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
    })
  })

  it('none is plain SMTP', () => {
    expect(smtpTransportOptions({ ...base, secure: 'none' }, logger)).toMatchObject({
      secure: false,
      requireTLS: false,
      ignoreTLS: true,
    })
  })

  it('sets every timeout (nodemailer waits two minutes by default) and a TLS floor', () => {
    const options = smtpTransportOptions(base, logger)
    expect(options).toMatchObject({
      connectionTimeout: SMTP_TIMEOUTS_MS.connection,
      greetingTimeout: SMTP_TIMEOUTS_MS.greeting,
      socketTimeout: SMTP_TIMEOUTS_MS.socket,
      dnsTimeout: SMTP_TIMEOUTS_MS.dns,
      tls: { minVersion: 'TLSv1.2' },
    })
    // The whole send has to fit inside the job's expiry (EMAIL_JOB_OPTIONS.expireInSeconds, 180 s).
    expect(SMTP_TIMEOUTS_MS.connection + SMTP_TIMEOUTS_MS.greeting + SMTP_TIMEOUTS_MS.socket).toBeLessThan(180_000)
  })

  it('keeps the SMTP conversation out of the log: no debug, no transaction log, no file or URL access', () => {
    const options = smtpTransportOptions(base, logger)
    expect(options.debug).toBe(false)
    expect(options).not.toHaveProperty('transactionLog')
    expect(options).toMatchObject({ disableFileAccess: true, disableUrlAccess: true })
  })

  it('logs through a child of our logger that passes warnings and errors only', () => {
    const { logger: parent, lines } = memoryLogger('trace')
    const options = smtpTransportOptions(base, parent)
    const log = options.logger
    expect(typeof log).toBe('object')
    if (typeof log !== 'object') {
      throw new Error('no logger')
    }
    log.debug?.({ tnx: 'smtp' }, 'AUTH PLAIN dXNlcgBwYXNz')
    log.info?.({ tnx: 'smtp' }, 'connected')
    log.warn?.({ tnx: 'smtp' }, 'slow server')
    log.error?.({ tnx: 'smtp' }, 'refused')
    expect(lines.map((line) => line['msg'])).toEqual(['slow server', 'refused'])
    expect(lines.every((line) => line['component'] === 'smtp')).toBe(true)
  })

  it('passes the login on, and none when there is none', () => {
    expect(smtpTransportOptions(base, logger).auth).toEqual({ user: 'u', pass: 'p' })
    expect(smtpTransportOptions({ ...base, auth: undefined }, logger)).not.toHaveProperty('auth')
  })
})

describe('what may be logged', () => {
  it('masks addresses, URLs and token-like strings in an error message', () => {
    const token = 'rJ3x9Qm2LkP7vN4sT8uYb1CdEfGhIjKlMnOpQrStUvW'
    const text = redactText(
      `550 5.1.1 <kari.nordmann@example.no>: Recipient rejected, see https://example.no/admin/login?action=resetpass#token=${token} or ${token}`,
    )
    expect(text).not.toContain('kari')
    expect(text).not.toContain('example.no')
    expect(text).not.toContain(token)
    expect(text).toContain('550 5.1.1')
    expect(text).toContain('Recipient rejected')
  })

  it('removes line breaks and other control characters', () => {
    expect(redactText('a\r\nb\u0000c')).toBe('a  b c')
  })

  it('describes an error by codes and a masked message, and not by its stack', () => {
    const err = Object.assign(new Error('Mail command failed: 550 <kari@example.no> not found'), {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO:<kari@example.no>',
    })
    const summary = summarizeError(err)
    expect(summary).toEqual({
      name: 'Error',
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO:<[address]>',
      message: 'Mail command failed: 550 <[address]> not found',
    })
    expect(JSON.stringify(summary)).not.toContain('kari')
    expect(summarizeError('boom')).toEqual({ name: 'NonError', message: 'a value that is not an Error was thrown' })
  })

  it.each([
    ['kari@Example.NO', 'example.no'],
    ['x@y@z.org', 'z.org'],
    ['no-at-sign', 'unknown'],
    ['@leading', 'unknown'],
    ['trailing@', 'unknown'],
    ['', 'unknown'],
  ])('recipientDomain(%j) is %s', (address, domain) => {
    expect(recipientDomain(address)).toBe(domain)
  })
})
