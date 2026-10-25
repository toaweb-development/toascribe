// markEmailVerified against a real PostgreSQL: the one writer of smtp_verified_at (M0.5).
import { SETUP_EMAIL_SKIPPED_NOTICE } from '@toascribe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { EmailSettings, markEmailVerified } from '../src/email-verified.ts'
import { readSettings } from '../src/repository.ts'
import { TEST_DATABASE_URL, noticeIfSkipped } from './db.ts'
import { SITE, SMTP, admin, resetInstall, startInstallEnv } from './harness.ts'
import type { InstallEnv } from './harness.ts'

noticeIfSkipped('install (email verified)')

const AT = new Date('2027-01-10T12:00:00.000Z')

describe.skipIf(TEST_DATABASE_URL === undefined)('markEmailVerified (needs TEST_DATABASE_URL)', () => {
  let env: InstallEnv

  beforeAll(async () => {
    env = await startInstallEnv()
  })
  afterAll(async () => {
    await env.close()
  })
  beforeEach(async () => {
    await resetInstall(env)
    await env.service.saveSite(SITE)
    await env.service.saveEmail(SMTP)
  })

  const sentWith = () => readSettings(env.db, EmailSettings)
  const input = async (requestedById?: string) => ({
    sentWith: await sentWith(),
    requestedById,
    at: AT,
    jobId: 'job-7',
  })
  const audit = () =>
    env.query<{
      actor_type: string
      actor: string
      account_id: string | null
      source: string
      new_value: unknown
      ip: string | null
    }>(
      `select actor_type, actor, account_id, source, new_value, ip from audit_log where action = 'system.email_verified'`,
    )

  it('sets the timestamp, resolves the skipped notice and audits it as the system when no account asked', async () => {
    await env.service.skipEmail()
    expect(await markEmailVerified(env.db, await input())).toBe(true)
    expect(await env.setting('smtp_verified_at')).toBe(AT.toISOString())
    expect((await env.footprint()).notices).toEqual([])
    expect(await audit()).toEqual([
      {
        actor_type: 'system',
        actor: 'email.send',
        account_id: null,
        source: 'job',
        new_value: { jobId: 'job-7' },
        ip: null,
      },
    ])
  })

  const insertAccount = async (username: string) => {
    const {
      rows: [row],
    } = await env.owner.query<{ id: string }>(
      `insert into account (username, email, display_name, nicename, password_hash, status)
       values ($1, 'dash.admin@secret-domain.test', 'Dash', 'dash-admin', 'x', 'active') returning id`,
      [username],
    )
    if (row === undefined) throw new Error('no account')
    return row.id
  }

  it('audits the administrator who asked, by account id, and stores no address', async () => {
    const id = await insertAccount('Dash-Admin')
    expect(await markEmailVerified(env.db, await input(id))).toBe(true)
    const [row] = await audit()
    expect(row).toMatchObject({ actor_type: 'account', actor: 'Dash-Admin', account_id: id, source: 'job' })
    expect(JSON.stringify(await audit())).not.toMatch(/@|secret-domain/)
  })

  it('names the account by its current username when the username changed after the mail was queued', async () => {
    const id = await insertAccount('old-name')
    const sent = await input(id)
    await env.owner.query(`update account set username = 'new-name' where id = $1`, [id])
    expect(await markEmailVerified(env.db, sent)).toBe(true)
    expect(await audit()).toMatchObject([{ actor_type: 'account', actor: 'new-name', account_id: id }])
  })

  it('audits the system when the account that asked has been deleted since', async () => {
    const id = await insertAccount('gone')
    const sent = await input(id)
    await env.owner.query('delete from account where id = $1', [id])
    expect(await markEmailVerified(env.db, sent)).toBe(true)
    expect(await audit()).toMatchObject([{ actor_type: 'system', actor: 'email.send', account_id: null }])
  })

  it('marks nothing when the settings were saved again after the mail was sent', async () => {
    await env.service.skipEmail()
    const sent = await input()
    await env.service.saveEmail({ ...SMTP, port: 2525 })
    expect(await markEmailVerified(env.db, sent)).toBe(false)
    expect(await env.setting('smtp_verified_at')).toBeNull()
    expect((await env.footprint()).notices).toEqual([SETUP_EMAIL_SKIPPED_NOTICE.key])
    expect(await audit()).toEqual([])
  })

  it('counts a password saved again as a change: the stored value is a new ciphertext', async () => {
    const sent = await input()
    await env.service.saveEmail({ ...SMTP, password: 'another-pw' })
    expect(await markEmailVerified(env.db, sent)).toBe(false)
    expect(await env.setting('smtp_verified_at')).toBeNull()
  })

  it('counts the unset settings (the defaults from .env) as the same unset settings', async () => {
    await env.owner.query(`delete from setting where key like 'smtp\\_%' or key like 'mail\\_from%'`)
    expect(await markEmailVerified(env.db, await input())).toBe(true)
  })

  it('ignores other keys in sentWith (the worker passes everything it read)', async () => {
    const sent = { ...(await sentWith()), blogname: 'something else', locale: 'nb' }
    expect(await markEmailVerified(env.db, { sentWith: sent, requestedById: undefined, at: AT, jobId: 'j' })).toBe(true)
  })

  it('also marks on a site that is installed already (a later test mail)', async () => {
    await env.service.install({ admin: admin('tor'), site: SITE, email: { skip: true }, source: 'cli' })
    const {
      rows: [tor],
    } = await env.owner.query<{ id: string }>(`select id from account where username = 'tor'`)
    expect(await markEmailVerified(env.db, await input(tor?.id))).toBe(true)
    expect(await env.setting('smtp_verified_at')).toBe(AT.toISOString())
    const [row] = await audit()
    expect(row).toMatchObject({ actor_type: 'account', actor: 'tor' })
  })
})
