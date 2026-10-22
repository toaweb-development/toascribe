// The `email.send` job handler against a real database (for the settings) and a stand-in transport (no network): payloads that
// are wrong are refused without a send, a good one is rendered and sent, and the log never holds an address or a token.
import { SMTP_PASSWORD_AAD, sealEmailMessage } from '@toascribe/shared'
import type { EmailMessage } from '@toascribe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { processEmailJob } from '../src/jobs/email.ts'
import type { EmailJobDeps } from '../src/jobs/email.ts'
import type { OutgoingMail, ResolvedSmtp, TransportFactory } from '../src/mail/smtp.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './helpers.ts'
import { memoryLogger, startJobDb, testKeyRing } from './harness.ts'
import type { JobDb } from './harness.ts'

noticeIfSkipped('worker email')

const TOKEN = 'rJ3x9Qm2LkP7vN4sT8uYb1CdEfGhIjKlMnOpQrStUvW'
const ORIGIN = 'https://cms.example.test'
const RESET: EmailMessage = {
  template: 'password_reset',
  to: 'kari.nordmann@example.no',
  data: { username: 'kari', token: TOKEN },
}

describe.skipIf(TEST_DATABASE_URL === undefined)('email job (needs TEST_DATABASE_URL)', () => {
  let env: JobDb

  beforeAll(async () => {
    env = await startJobDb()
  })
  afterAll(async () => {
    await env.close()
  })

  const sent: { smtp: ResolvedSmtp; mail: OutgoingMail }[] = []
  let failWith: Error | undefined
  let closed = 0

  const transport: TransportFactory = (smtp) => ({
    send(mail) {
      if (failWith !== undefined) {
        return Promise.reject(failWith)
      }
      sent.push({ smtp, mail })
      return Promise.resolve()
    },
    close() {
      closed += 1
    },
  })

  beforeEach(async () => {
    sent.length = 0
    failWith = undefined
    closed = 0
    await env.query("delete from setting where key like 'smtp\\_%' or key like 'mail\\_from%'")
    await setSetting('blogname', 'Bloggen min')
    await setSetting('locale', 'nb')
  })

  async function setSetting(key: string, value: unknown): Promise<void> {
    await env.query(
      `insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    )
  }

  function deps(overrides: Partial<EmailJobDeps> = {}) {
    const { logger, lines } = memoryLogger('trace')
    const value: EmailJobDeps = {
      db: env.db,
      keyRing: testKeyRing,
      logger,
      publicOrigin: ORIGIN,
      mailDefaults: { SMTP_HOST: 'smtp.example.test', SMTP_SECURE: 'tls', MAIL_FROM_ADDRESS: 'noreply@example.test' },
      transport,
      ...overrides,
    }
    return { deps: value, lines }
  }

  async function job(message: EmailMessage, extra: { retryCount?: number; retryLimit?: number } = {}) {
    return { id: 'job-1', name: 'email.send', data: await sealEmailMessage(message, testKeyRing), ...extra }
  }

  it('renders the mail in bokmål, builds the link from PUBLIC_ORIGIN, and sends it from the configured sender', async () => {
    const { deps: d } = deps()
    const outcome = await processEmailJob(await job(RESET), d)
    expect(outcome).toEqual({ id: 'job-1', status: 'completed', output: { sent: true } })
    expect(sent).toHaveLength(1)
    const mail = sent[0]?.mail
    expect(mail).toMatchObject({
      from: { address: 'noreply@example.test', name: 'Bloggen min' },
      to: 'kari.nordmann@example.no',
      subject: '[Bloggen min] Tilbakestill passordet',
    })
    expect(mail?.text).toContain('Noen har bedt om å tilbakestille passordet')
    expect(mail?.text).toContain(`${ORIGIN}/admin/login?action=resetpass#token=${TOKEN}`)
    expect(mail?.html).toContain(`href="${ORIGIN}/admin/login?action=resetpass#token=${TOKEN}"`)
    expect(closed).toBe(1)
  })

  it('takes the site name and language from the settings', async () => {
    await setSetting('blogname', 'Tøyseblogg')
    const { deps: d } = deps()
    await processEmailJob(await job({ template: 'test', to: 'a@example.test', data: { requestedBy: 'admin' } }), d)
    expect(sent[0]?.mail.subject).toBe('[Tøyseblogg] Test av e-post')
    expect(sent[0]?.mail.from.name).toBe('Tøyseblogg')
  })

  it('uses the host name of PUBLIC_ORIGIN when the site has no name yet', async () => {
    await setSetting('blogname', '')
    const { deps: d } = deps()
    await processEmailJob(await job({ template: 'test', to: 'a@example.test', data: { requestedBy: 'admin' } }), d)
    expect(sent[0]?.mail.subject).toBe('[cms.example.test] Test av e-post')
  })

  it('takes the connection from the settings before the environment, and decrypts the password', async () => {
    await setSetting('smtp_host', 'smtp.setting.test')
    await setSetting('smtp_port', 2525)
    await setSetting('smtp_secure', 'starttls')
    await setSetting('smtp_username', 'mailer')
    await setSetting('smtp_password', await testKeyRing.encrypt('s3cret-from-settings', SMTP_PASSWORD_AAD))
    await setSetting('mail_from_address', 'hello@setting.test')
    await setSetting('mail_from_name', 'Fra innstillingene')
    const { deps: d, lines } = deps()
    const outcome = await processEmailJob(await job(RESET), d)
    expect(outcome.status).toBe('completed')
    expect(sent[0]?.smtp).toEqual({
      host: 'smtp.setting.test',
      port: 2525,
      secure: 'starttls',
      auth: { user: 'mailer', pass: 's3cret-from-settings' },
      from: { address: 'hello@setting.test', name: 'Fra innstillingene' },
    })
    expect(JSON.stringify(lines)).not.toContain('s3cret-from-settings')
  })

  it('falls back to the environment when the settings are null', async () => {
    const { deps: d } = deps({
      mailDefaults: { SMTP_HOST: 'smtp.env.test', MAIL_FROM_ADDRESS: 'env@example.test', MAIL_FROM_NAME: 'Env' },
    })
    await processEmailJob(await job(RESET), d)
    expect(sent[0]?.smtp).toMatchObject({
      host: 'smtp.env.test',
      secure: 'starttls',
      from: { address: 'env@example.test', name: 'Env' },
    })
  })

  it('ignores an invalid stored setting (the default is used) and says which key', async () => {
    await setSetting('smtp_host', 'not a host!')
    const { deps: d, lines } = deps()
    expect((await processEmailJob(await job(RESET), d)).status).toBe('completed')
    expect(sent[0]?.smtp.host).toBe('smtp.example.test')
    expect(
      lines.some(
        (line) => line['msg'] === 'a stored setting is invalid; the default is used' && line['key'] === 'smtp_host',
      ),
    ).toBe(true)
  })

  describe('a payload that is wrong', () => {
    it.each([
      ['not an object', 'password_reset'],
      ['an unknown template', { template: 'newsletter', to: 'a@example.test', data: {} }],
      ['a plain token (it should be sealed)', { ...RESET, data: { username: 'kari', token: TOKEN } }],
      ['an address that is not one', { template: 'test', to: 'nope', data: { requestedBy: 'a' } }],
      ['an extra field', { template: 'test', to: 'a@example.test', data: { requestedBy: 'a' }, bcc: 'b@example.test' }],
      ['null', null],
    ])('is refused for good (%s): no send, no retry', async (_name, data) => {
      const { deps: d, lines } = deps()
      const outcome = await processEmailJob({ id: 'job-bad', name: 'email.send', data }, d)
      expect(outcome.status).toBe('deadletter')
      expect(outcome.output).toMatchObject({ error: 'invalid_payload' })
      expect(sent).toHaveLength(0)
      const refusal = lines.find((line) => line['msg'] === 'e-mail job refused: the payload is not valid')
      expect(refusal).toMatchObject({ jobId: 'job-bad' })
      // The log names fields and never shows values.
      expect(JSON.stringify(lines)).not.toContain(TOKEN)
      expect(JSON.stringify(lines)).not.toContain('a@example.test')
    })

    it('with a token sealed for another recipient is refused for good: it cannot be moved to another job', async () => {
      const other = await sealEmailMessage({ ...RESET, to: 'someone.else@example.no' }, testKeyRing)
      const moved = { ...other, to: RESET.to }
      const { deps: d } = deps()
      const outcome = await processEmailJob({ id: 'job-moved', name: 'email.send', data: moved }, d)
      expect(outcome).toMatchObject({ status: 'deadletter', output: { error: 'undecryptable' } })
      expect(sent).toHaveLength(0)
    })

    it('with a token sealed for another template is refused for good', async () => {
      const other = await sealEmailMessage({ ...RESET, template: 'set_password' }, testKeyRing)
      const { deps: d } = deps()
      const outcome = await processEmailJob(
        { id: 'j', name: 'email.send', data: { ...other, template: 'password_reset' } },
        d,
      )
      expect(outcome.status).toBe('deadletter')
    })
  })

  describe('a send that cannot happen now', () => {
    it('is failed (and so retried) when no SMTP host is configured anywhere, with an error that names the setting', async () => {
      const { deps: d, lines } = deps({ mailDefaults: {} })
      const outcome = await processEmailJob(await job(RESET, { retryCount: 0, retryLimit: 5 }), d)
      expect(outcome).toEqual({ id: 'job-1', status: 'failed', output: { error: 'mail_config' } })
      const error = lines.find((line) => line['level'] === 50)
      expect(error?.['msg']).toBe('e-mail not sent; it will be tried again')
      expect(JSON.stringify(error)).toContain('smtp_host')
    })

    it('is failed when the server refuses, and the log holds the codes but not the address', async () => {
      failWith = Object.assign(new Error('Mail command failed: 550 5.1.1 <kari.nordmann@example.no> User unknown'), {
        code: 'EENVELOPE',
        responseCode: 550,
      })
      const { deps: d, lines } = deps()
      const outcome = await processEmailJob(await job(RESET, { retryCount: 1, retryLimit: 5 }), d)
      expect(outcome).toEqual({ id: 'job-1', status: 'failed', output: { error: 'send_failed' } })
      const warning = lines.find((line) => line['msg'] === 'e-mail not sent; it will be tried again')
      expect(warning).toMatchObject({
        jobId: 'job-1',
        template: 'password_reset',
        recipientDomain: 'example.no',
        attempt: 2,
        willRetry: true,
        err: { code: 'EENVELOPE', responseCode: 550 },
      })
      expect(JSON.stringify(lines)).not.toContain('kari.nordmann')
      expect(closed).toBe(1) // the connection is closed after a failure too
    })

    it('logs an error when the last try fails', async () => {
      failWith = new Error('connect ETIMEDOUT')
      const { deps: d, lines } = deps()
      await processEmailJob(await job(RESET, { retryCount: 5, retryLimit: 5 }), d)
      const last = lines.find((line) => line['msg'] === 'e-mail not sent; giving up')
      expect(last).toMatchObject({ level: 50, willRetry: false, attempt: 6 })
    })

    it('is failed when the smtp_password setting cannot be decrypted', async () => {
      await setSetting('smtp_username', 'mailer')
      await setSetting('smtp_password', 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      const { deps: d } = deps()
      const outcome = await processEmailJob(await job(RESET), d)
      expect(outcome).toMatchObject({ status: 'failed', output: { error: 'mail_config' } })
      expect(sent).toHaveLength(0)
    })
  })

  it('never writes the token, the address or the data to the log, at any level, on success or failure', async () => {
    const { deps: d, lines } = deps()
    await processEmailJob(await job(RESET), d)
    failWith = new Error(`rejected ${RESET.to} with ${TOKEN}`)
    await processEmailJob(await job(RESET), d)
    const text = JSON.stringify(lines)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('kari.nordmann')
    expect(text).not.toContain('"kari"')
    // What it does log.
    expect(lines.find((line) => line['msg'] === 'e-mail sent')).toMatchObject({
      jobId: 'job-1',
      queue: 'email.send',
      template: 'password_reset',
      recipientDomain: 'example.no',
    })
  })

  it('refuses the payload before it touches the settings or the transport', async () => {
    let touched = false
    const { deps: d } = deps({
      transport: () => {
        touched = true
        return { send: () => Promise.resolve(), close: () => undefined }
      },
    })
    await processEmailJob({ id: 'x', name: 'email.send', data: {} }, d)
    expect(touched).toBe(false)
  })
})
