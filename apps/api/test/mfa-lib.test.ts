// The TOTP wrapper against RFC 6238's own test vectors, and the recovery code format.
import { describe, expect, it } from 'vitest'

import {
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../src/lib/recovery-codes.ts'
import { ACCOUNT_FLOW_MINIMUM_MS, withMinimumDuration } from '../src/lib/timing.ts'
import {
  TOTP_PERIOD_SECONDS,
  generateTotpSecret,
  matchTotpStep,
  normalizeTotpCode,
  qrSvg,
  totpCodeAt,
  totpUri,
} from '../src/lib/totp.ts'

/** RFC 6238 Appendix B: the SHA-1 secret is the ASCII string 12345678901234567890; its base32 form is below. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('TOTP (RFC 6238)', () => {
  // The RFC lists 8-digit codes; the 6 digits we use are the last six of those.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('makes the RFC code at T=%i', (seconds, expected) => {
    expect(totpCodeAt(RFC_SECRET, seconds * 1000)).toBe(expected)
  })

  const NOW = 1234567890 * 1000
  const STEP = Math.floor(NOW / 1000 / TOTP_PERIOD_SECONDS)

  it('accepts the code of the current step, and of the step before and after, and says which step it was', () => {
    expect(matchTotpStep(RFC_SECRET, totpCodeAt(RFC_SECRET, NOW), NOW)).toBe(STEP)
    expect(matchTotpStep(RFC_SECRET, totpCodeAt(RFC_SECRET, NOW - 30_000), NOW)).toBe(STEP - 1)
    expect(matchTotpStep(RFC_SECRET, totpCodeAt(RFC_SECRET, NOW + 30_000), NOW)).toBe(STEP + 1)
  })

  it('refuses a code two steps away, either way', () => {
    expect(matchTotpStep(RFC_SECRET, totpCodeAt(RFC_SECRET, NOW - 60_000), NOW)).toBeNull()
    expect(matchTotpStep(RFC_SECRET, totpCodeAt(RFC_SECRET, NOW + 60_000), NOW)).toBeNull()
  })

  it('refuses a wrong code, a code of the wrong length and text that is not digits', () => {
    const right = totpCodeAt(RFC_SECRET, NOW)
    const wrong = right === '000000' ? '000001' : '000000'
    expect(matchTotpStep(RFC_SECRET, wrong, NOW)).toBeNull()
    expect(matchTotpStep(RFC_SECRET, right.slice(1), NOW)).toBeNull()
    expect(matchTotpStep(RFC_SECRET, `${right}0`, NOW)).toBeNull()
    expect(matchTotpStep(RFC_SECRET, 'abcdef', NOW)).toBeNull()
    expect(matchTotpStep(RFC_SECRET, '', NOW)).toBeNull()
  })

  it('takes a code typed with a space in the middle', () => {
    const code = totpCodeAt(RFC_SECRET, NOW)
    expect(normalizeTotpCode(` ${code.slice(0, 3)} ${code.slice(3)} `)).toBe(code)
    expect(matchTotpStep(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, NOW)).toBe(STEP)
  })

  it('makes a 160-bit base32 secret, never the same twice', () => {
    const a = generateTotpSecret()
    expect(a).toMatch(/^[A-Z2-7]{32}$/)
    expect(generateTotpSecret()).not.toBe(a)
  })

  it('writes the otpauth address an authenticator app reads', () => {
    const uri = totpUri(RFC_SECRET, 'Bloggen min', 'kari')
    const parsed = new URL(uri)
    expect(parsed.protocol).toBe('otpauth:')
    expect(parsed.host).toBe('totp')
    expect(decodeURIComponent(parsed.pathname)).toBe('/Bloggen min:kari')
    expect(parsed.searchParams.get('secret')).toBe(RFC_SECRET)
    expect(parsed.searchParams.get('issuer')).toBe('Bloggen min')
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1')
    expect(parsed.searchParams.get('digits')).toBe('6')
    expect(parsed.searchParams.get('period')).toBe('30')
  })

  it('renders the address as an SVG document', () => {
    const svg = qrSvg(totpUri(RFC_SECRET, 'x', 'y'))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain(RFC_SECRET)
  })
})

describe('recovery codes', () => {
  it('makes ten codes of four groups of four Crockford base32 characters, all different', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    }
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('reads a code however it was typed', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS')
    expect(normalizeRecoveryCode('  ABCD EFGH JKMN PQRS ')).toBe('ABCDEFGHJKMNPQRS')
    expect(normalizeRecoveryCode('ABCDEFGHJKMNPQRS')).toBe('ABCDEFGHJKMNPQRS')
    // O, I and L are the same as 0, 1 and 1.
    expect(normalizeRecoveryCode('O0Il-1111-1111-1111')).toBe('0011111111111111')
  })

  it('refuses what cannot be a code', () => {
    for (const bad of [
      '',
      'ABCD',
      'ABCD-EFGH-JKMN-PQR',
      'ABCD-EFGH-JKMN-PQRSS',
      'ABCD-EFGH-JKMN-PQRU',
      'ÆBCD-EFGH-JKMN-PQRS',
    ]) {
      expect(normalizeRecoveryCode(bad), bad).toBeUndefined()
    }
  })

  it('formats and normalises to the same thing', () => {
    const code = generateRecoveryCodes(1)[0] ?? ''
    expect(formatRecoveryCode(normalizeRecoveryCode(code) ?? '')).toBe(code)
  })

  it('hashes to 64 hex characters, differently for another account or another code', () => {
    const a = hashRecoveryCode('account-1', 'ABCDEFGHJKMNPQRS')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashRecoveryCode('account-2', 'ABCDEFGHJKMNPQRS')).not.toBe(a)
    expect(hashRecoveryCode('account-1', 'ABCDEFGHJKMNPQRT')).not.toBe(a)
    expect(a).not.toContain('ABCDEFGH')
  })
})

describe('withMinimumDuration', () => {
  it('waits out the minimum when the work is quicker, for a result and for an error', async () => {
    const started = performance.now()
    expect(await withMinimumDuration(80, () => Promise.resolve('ok'))).toBe('ok')
    expect(performance.now() - started).toBeGreaterThanOrEqual(75)

    const failed = performance.now()
    await expect(withMinimumDuration(80, () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(performance.now() - failed).toBeGreaterThanOrEqual(75)
  })

  it('adds nothing when the work already took longer', async () => {
    const started = performance.now()
    await withMinimumDuration(20, () => new Promise<void>((resolve) => setTimeout(resolve, 60)))
    expect(performance.now() - started).toBeLessThan(120)
  })

  it('has a default long enough to cover a database round trip and short enough to be unnoticed', () => {
    expect(ACCOUNT_FLOW_MINIMUM_MS).toBeGreaterThanOrEqual(250)
    expect(ACCOUNT_FLOW_MINIMUM_MS).toBeLessThanOrEqual(1000)
  })
})
