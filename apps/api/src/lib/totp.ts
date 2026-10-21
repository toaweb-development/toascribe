// Time-based one-time passwords (RFC 6238; K-023): SHA-1, six digits, 30-second steps, the parameters every authenticator
// app supports. The library is otpauth; this file is the only place that imports it.
import { Secret, TOTP } from 'otpauth'
import { renderSVG } from 'uqr'

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
/** Steps accepted on each side of the current one: a phone clock that is up to 30 seconds off still works. */
export const TOTP_WINDOW = 1

/** A new 160-bit secret (RFC 4226 §4: at least 128, 160 recommended), as base32 for typing and for the QR code. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

function totpFor(secretBase32: string, issuer: string, label: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  })
}

/** The `otpauth://totp/...` address an authenticator app reads from the QR code. */
export function totpUri(secretBase32: string, issuer: string, label: string): string {
  return totpFor(secretBase32, issuer, label).toString()
}

/** The QR code of an address as an SVG document. Made from the address alone: nothing a visitor typed goes into the markup. */
export function qrSvg(text: string): string {
  return renderSVG(text, { ecc: 'M', border: 2 })
}

/** Digits only, from what a person typed («123 456»). */
export function normalizeTotpCode(input: string): string {
  return input.replace(/\s+/g, '')
}

/**
 * The time step (seconds since the epoch divided by 30) the code belongs to, or null when it matches none of the accepted
 * steps. The caller must record the step and refuse a code whose step is not later than the last accepted one (replay).
 */
export function matchTotpStep(secretBase32: string, code: string, atMs: number): number | null {
  const delta = totpFor(secretBase32, 'toascribe', 'check').validate({
    token: normalizeTotpCode(code),
    timestamp: atMs,
    window: TOTP_WINDOW,
  })
  if (delta === null) {
    return null
  }
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS) + delta
}

/** The code for a moment, for tests and nothing else. */
export function totpCodeAt(secretBase32: string, atMs: number): string {
  return totpFor(secretBase32, 'toascribe', 'check').generate({ timestamp: atMs })
}
