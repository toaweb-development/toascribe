import { z } from 'zod'

// A secret stored encrypted with the site's encryption key from .env (K-318, app-config 3b): the TOTP secret, the SMTP
// password, later webhook secrets. The value starts with its format version, `v1:`, so a later format or a rotated key
// can be told apart and read without losing data. What follows the prefix (nonce, ciphertext, tag, key id) is the
// encryption helper's layout; this schema only checks the envelope: `v<n>:`, then base64url segments, which may be
// separated by `.` or `:`. It never decrypts and never sees the plain text.

/** Longer than any secret toascribe stores, short enough that a setting row stays small. */
const MAX_ENCRYPTED_LENGTH = 4096

export const ENCRYPTED_VALUE_PATTERN = /^v[1-9]\d{0,3}:[A-Za-z0-9_-]+(?:[.:][A-Za-z0-9_-]+)*$/

export const EncryptedValue = z.string().max(MAX_ENCRYPTED_LENGTH).regex(ENCRYPTED_VALUE_PATTERN)
export type EncryptedValue = z.infer<typeof EncryptedValue>
