import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Bytes of randomness in a session token or a one-time link token: 256 bits. */
const TOKEN_BYTES = 32

/** A new random token, as it is sent to the browser or put in a link: 43 characters of base64url. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * What the database keeps of a token: its SHA-256, in hex. The token itself is 256 random bits, so nobody can search for
 * it from the hash, and a plain hash is enough (a slow password hash or a keyed one would add nothing). Not keyed with the
 * signing key on purpose: rotating that key must not end every session, and the CLI must be able to make links without it.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Equality that takes the same time wherever the strings differ, and for strings of different length. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

/**
 * The CSRF token of a session (K-258): an HMAC of the session id under the signing key. It needs no storage, differs for
 * every session, and cannot be made without the key. Rotating the signing key only makes clients fetch a new one.
 */
export function csrfTokenFor(signingKey: Uint8Array, sessionId: string): string {
  return createHmac('sha256', signingKey).update(`csrf-v1:${sessionId}`).digest('base64url')
}
