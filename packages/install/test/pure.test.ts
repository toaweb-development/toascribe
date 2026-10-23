// The parts of the install service that need no database: the recovery key and the reading of the address the browser used.
import { createHmac } from 'node:crypto'

import { RECOVERY_KEY_PATTERN, RecoveryKey } from '@toascribe/shared'
import { describe, expect, it } from 'vitest'

import { observeOrigin } from '../src/observed-origin.ts'
import {
  RECOVERY_KEY_VERIFIER_LABEL,
  generateRecoveryKey,
  normalizeRecoveryKey,
  recoveryKeyVerifier,
  verifyRecoveryKey,
} from '../src/recovery-key.ts'

describe('the recovery key', () => {
  it('has eight groups of four, 160 bits, from the alphabet without I, L, O and U', () => {
    for (let i = 0; i < 200; i += 1) {
      const key = generateRecoveryKey()
      expect(key).toMatch(RECOVERY_KEY_PATTERN)
      expect(RecoveryKey.safeParse(key).success).toBe(true)
      expect(key).not.toMatch(/[ILOU]/)
      expect(key.replaceAll('-', '')).toHaveLength(32)
    }
  })

  it('is different every time', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateRecoveryKey()))
    expect(keys.size).toBe(500)
  })

  it('uses every character of the alphabet and so all 5 bits of each (no bias towards a few characters)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i += 1) {
      for (const character of generateRecoveryKey().replaceAll('-', '')) {
        seen.add(character)
      }
    }
    expect(seen.size).toBe(32)
  })

  it('reads a typed key leniently: case, hyphens, spaces and the characters Crockford treats as one', () => {
    const key = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789'
    expect(normalizeRecoveryKey(key)).toBe(key)
    expect(normalizeRecoveryKey(key.toLowerCase())).toBe(key)
    expect(normalizeRecoveryKey(key.replaceAll('-', ' '))).toBe(key)
    expect(normalizeRecoveryKey(key.replaceAll('-', ''))).toBe(key)
    // O is read as 0, and I and L as 1.
    expect(normalizeRecoveryKey('abcd-efgh-jkmn-pqrs-tvwx-yzOl-2345-6789')).toBe(key)
    expect(normalizeRecoveryKey('abcd-efgh-jkmn-pqrs-tvwx-yzoi-2345-6789')).toBe(key)
  })

  it('refuses text that cannot be a key', () => {
    for (const text of [
      '',
      'ABCD',
      'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-678',
      'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-678U',
      '💥'.repeat(32),
    ]) {
      expect(normalizeRecoveryKey(text), text).toBeUndefined()
      expect(recoveryKeyVerifier(text), text).toBeUndefined()
    }
  })

  it('has a verifier that is HMAC-SHA256 of the canonical text under the fixed label, in lower-case hex', () => {
    const key = generateRecoveryKey()
    const expected = createHmac('sha256', RECOVERY_KEY_VERIFIER_LABEL).update(key).digest('hex')
    expect(recoveryKeyVerifier(key)).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
    // The same key typed another way has the same verifier.
    expect(recoveryKeyVerifier(key.toLowerCase().replaceAll('-', ' '))).toBe(expected)
    // The verifier does not contain the key.
    expect(expected).not.toContain(key.replaceAll('-', '').slice(0, 8).toLowerCase())
  })

  it('verifies the right key and only that one', () => {
    const key = generateRecoveryKey()
    const stored = recoveryKeyVerifier(key) ?? ''
    expect(verifyRecoveryKey(key, stored)).toBe(true)
    expect(verifyRecoveryKey(key.toLowerCase(), stored)).toBe(true)
    expect(verifyRecoveryKey(generateRecoveryKey(), stored)).toBe(false)
    expect(verifyRecoveryKey('not a key', stored)).toBe(false)
    expect(verifyRecoveryKey(key, '')).toBe(false)
  })
})

describe('the address the browser used', () => {
  const configured = 'https://cms.example.no'

  it('prefers Origin, then Referer, then the forwarded host, then Host', () => {
    expect(
      observeOrigin({ origin: 'https://a.example', referer: 'https://b.example/x', host: 'c.example' }, configured),
    ).toEqual({
      origin: 'https://a.example',
      source: 'origin',
    })
    expect(observeOrigin({ referer: 'https://b.example/admin/setup?token=x', host: 'c.example' }, configured)).toEqual({
      origin: 'https://b.example',
      source: 'referer',
    })
    expect(
      observeOrigin({ forwardedProto: 'http', forwardedHost: 'd.example', host: 'c.example' }, configured),
    ).toEqual({ origin: 'http://d.example', source: 'forwarded' })
    expect(observeOrigin({ host: 'c.example:8080' }, configured)).toEqual({
      origin: 'https://c.example:8080',
      source: 'host',
    })
  })

  it('takes the first entry of a list the proxies appended to', () => {
    expect(
      observeOrigin({ forwardedProto: 'https, http', forwardedHost: 'public.example, inner.local' }, configured),
    ).toEqual({ origin: 'https://public.example', source: 'forwarded' })
  })

  it('ignores a value that is not an http(s) origin and falls through to the next', () => {
    expect(observeOrigin({ origin: 'null', referer: 'not a url', host: 'c.example' }, configured)).toEqual({
      origin: 'https://c.example',
      source: 'host',
    })
    expect(observeOrigin({ origin: 'file:///etc/passwd', host: 'bad host with spaces' }, configured)).toBeNull()
    expect(observeOrigin({}, configured)).toBeNull()
  })

  it('does not take a protocol header it does not know', () => {
    expect(observeOrigin({ forwardedProto: 'gopher', forwardedHost: 'x.example' }, configured)).toEqual({
      origin: 'https://x.example',
      source: 'forwarded',
    })
  })
})
