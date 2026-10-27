// Nettstedshelse's copy (M1.7, K-203): secrets, tokens, e-mail addresses, addresses and paths become [skjult]; versions, sizes,
// times, time zones and the permalink structure stay readable.
import { describe, expect, it } from 'vitest'

import { REDACTED, redactForCopy, siteHealthText } from '../src/system.ts'
import type { SiteHealthGroup } from '../src/system.ts'

describe('redactForCopy', () => {
  it.each([
    ['admin@example.com'],
    ['Kontakt: ola.nordmann+blogg@post.example.no'],
    ['postgres://toascribe_app:hemmelig@postgres:5432/toascribe'],
    ['redis://:passord@valkey:6379'],
    ['https://example.com/admin/setup#token=abcdef'],
    ['/var/lib/toascribe/uploads'],
    ['/etc/toascribe/toascribe.toml'],
    ['~/projects/toascribe/.env'],
    ['C:\\Users\\tor\\backup.tar.zst'],
    ['TOASCRIBE_ENCRYPTION_KEY=8f14e45fceea167a5a36dedd4bea2543'],
    ['password: hunter2'],
    ['smtp_password=hunter2'],
    ['Bearer eyJhbGciOiJIUzI1NiJ9abc123def456ghi789'],
    ['age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p'],
    ['8f14e45fceea167a5a36dedd4bea2543c9f0f895fb98ab9159f51fd0297e236d'],
  ])('hides %s', (value) => {
    const out = redactForCopy(value)
    expect(out).toContain(REDACTED)
    for (const secret of [
      'example',
      'hemmelig',
      'passord',
      'abcdef',
      'uploads',
      'toascribe.toml',
      '.env',
      'tor',
      'hunter2',
    ]) {
      if (value.includes(secret)) expect(out, value).not.toContain(secret)
    }
    expect(out).not.toMatch(/[0-9a-f]{24,}/)
  })

  it.each([
    ['0.6.0'],
    ['v24.22.0'],
    ['Linux 7.2.10-200.fc44.x86_64 x64'],
    ['18.6'],
    ['Europe/Oslo'],
    ['/%year%/%monthnum%/%postname%/'],
    ['2026-10-27T20:30:12.614Z'],
    ['toascribe-20261027-203012Z-0.6.0.tar.zst'],
    ['0014_journal_read_for_backups'],
    ['valkey'],
  ])('keeps %s', (value) => {
    expect(redactForCopy(value)).toBe(value)
  })
})

describe('siteHealthText', () => {
  it('writes one section per group, every value redacted', () => {
    const groups: SiteHealthGroup[] = [
      {
        key: 'toascribe',
        fields: [
          { key: 'version', kind: 'text', value: '0.6.0' },
          { key: 'environment', kind: 'word', value: 'production' },
        ],
      },
      {
        key: 'site',
        fields: [
          { key: 'adminEmail', kind: 'text', value: 'admin@example.com' },
          { key: 'public', kind: 'boolean', value: true },
          { key: 'logo', kind: 'text', value: null },
        ],
      },
    ]
    expect(siteHealthText(groups)).toBe(
      '### toascribe\nversion: 0.6.0\nenvironment: production\n\n### site\nadminEmail: [skjult]\npublic: true\nlogo: -\n',
    )
  })
})
