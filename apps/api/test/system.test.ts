import { TestEmailResponse } from '@toascribe/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { startAuthApp } from './harness.ts'
import type { AuthTestApp, TestClient } from './harness.ts'

noticeIfSkipped('system')

const PATH = '/api/v1/system/test-email'

describe.skipIf(TEST_DATABASE_URL === undefined)('POST /system/test-email (needs TEST_DATABASE_URL)', () => {
  let env: AuthTestApp
  const SENT_FROM = '198.51.100.20'

  beforeAll(async () => {
    env = await startAuthApp()
  })
  afterAll(async () => {
    await env.close()
  })

  const ids = new Map<string, string>()

  async function admin(name: string): Promise<TestClient> {
    const account = await env.createAccount({ username: name, role: 'administrator' })
    ids.set(name, account.id)
    const client = env.client({ ip: SENT_FROM })
    expect((await client.login(account.username, 'correct horse battery staple')).status).toBe(200)
    return client
  }

  it("queues a test mail to the caller's own address and returns the job id", async () => {
    const client = await admin('mail-self')
    const before = env.mail.sent.length
    const res = await client.post(PATH, {})
    expect(res.status).toBe(202)
    expect(TestEmailResponse.parse(await res.json()).jobId).not.toBe('')
    expect(env.mail.sent.slice(before)).toEqual([
      {
        template: 'test',
        to: 'mail-self@example.test',
        data: { requestedBy: 'mail-self', requestedById: ids.get('mail-self') },
      },
    ])
  })

  it('accepts a request without a body', async () => {
    const client = await admin('mail-nobody')
    const res = await client.post(PATH)
    expect(res.status).toBe(202)
    expect(env.mail.sent.at(-1)?.to).toBe('mail-nobody@example.test')
  })

  it('sends to another address when one is given', async () => {
    const client = await admin('mail-other')
    const res = await client.post(PATH, { to: 'someone.else@example.test' })
    expect(res.status).toBe(202)
    expect(env.mail.sent.at(-1)).toMatchObject({ template: 'test', to: 'someone.else@example.test' })
  })

  it.each([
    ['an address that is not one', { to: 'not-an-address' }],
    ['a header injection', { to: 'a@example.test\r\nBcc: b@example.test' }],
    ['an address that is too long', { to: `${'a'.repeat(250)}@example.test` }],
    ['a field it does not have', { to: 'a@example.test', cc: 'b@example.test' }],
    ['a recipient that is not text', { to: 42 }],
  ])('refuses %s with 400 and queues nothing', async (_name, body) => {
    const client = await admin(`mail-bad-${String(Math.random()).slice(2, 8)}`)
    const before = env.mail.sent.length
    const res = await client.post(PATH, body)
    expect(res.status).toBe(400)
    expect(env.mail.sent).toHaveLength(before)
  })

  it('needs the CSRF token and a same-origin JSON request', async () => {
    const client = await admin('mail-csrf')
    const before = env.mail.sent.length
    expect((await client.post(PATH, {}, { csrf: 'none' })).status).toBe(403)
    expect((await client.post(PATH, {}, { csrf: 'wrong-token' })).status).toBe(403)
    expect((await client.post(PATH, {}, { origin: 'https://evil.example' })).status).toBe(400)
    expect((await client.request('POST', PATH, { body: 'to=a@example.test', contentType: 'text/plain' })).status).toBe(
      400,
    )
    expect(env.mail.sent).toHaveLength(before)
  })

  it('answers 429 with Retry-After for a second test mail from the same account in the window', async () => {
    const client = await admin('mail-twice')
    expect((await client.post(PATH, {})).status).toBe(202)
    const before = env.mail.sent.length
    const again = await client.post(PATH, {})
    expect(again.status).toBe(429)
    expect(again.headers.get('retry-after')).toBe('30')
    expect(await again.json()).toMatchObject({ error: { code: 'too_many_requests' } })
    expect(env.mail.sent).toHaveLength(before)
    // Another account has its own window.
    const other = await admin('mail-twice-other')
    expect((await other.post(PATH, {})).status).toBe(202)
  })

  it("writes an audit entry with the recipient's domain and not the address", async () => {
    const client = await admin('mail-audit')
    const res = await client.post(PATH, { to: 'private.person@secret-domain.test' })
    expect(res.status).toBe(202)
    const { jobId } = TestEmailResponse.parse(await res.json())
    const rows = await env.query<{ actor: string; action: string; new_value: unknown; source: string }>(
      "select actor, action, new_value, source from audit_log where action = 'system.test_email' and actor = 'mail-audit'",
    )
    expect(rows).toEqual([
      {
        actor: 'mail-audit',
        action: 'system.test_email',
        new_value: { recipientDomain: 'secret-domain.test', jobId },
        source: 'api',
      },
    ])
    expect(JSON.stringify(rows)).not.toContain('private.person')
  })

  it('is not cached', async () => {
    const client = await admin('mail-cache')
    expect((await client.post(PATH, {})).headers.get('cache-control')).toBe('no-store')
  })
})
