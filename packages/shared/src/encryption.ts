import { EncryptedValue } from './encrypted.ts'

// Field encryption for secrets kept in the database: the TOTP secret, the SMTP password, later webhook secrets (K-318,
// app-config 3b). Both the api and the worker use it (the worker decrypts the SMTP password), so it lives here and uses
// only WebCrypto (`globalThis.crypto`), which Node 24 and every browser have. Nothing else from Node is imported, so a
// bundler can include this file in a browser build without a polyfill (the admin app never calls it).
//
// Format: `v<n>:` + base64url(iv | ciphertext | tag).
// - AES-256-GCM, a random 96-bit IV per value (NIST SP 800-38D: random IVs are fine up to 2^32 values per key), and a
//   128-bit tag, which WebCrypto appends to the ciphertext.
// - The additional authenticated data (AAD) is the identity of the field the value belongs to, for example
//   `setting:smtp_password` or `mfa_credential:<id>`. A value copied into another field does not decrypt.
// - `<n>` names the key that encrypted it. A key ring holds the current key and any older ones, so rotating means:
//   add the new key as current, keep the old one for reading, re-encrypt, then drop the old one. Nothing is lost.

const ALGORITHM = 'AES-GCM'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_VERSION = 9999

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** Thrown for every decryption failure. The message never says why, so it cannot act as an oracle. */
export class DecryptionError extends Error {
  constructor() {
    super('The value could not be decrypted')
    this.name = 'DecryptionError'
  }
}

/** Thrown for a key that is not usable. The message names the rule and never prints key material. */
export class KeyMaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyMaterialError'
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    return undefined
  }
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return undefined
  }
}

/**
 * Reads a 32-byte key written as 64 hex characters or as base64 or base64url (`openssl rand -hex 32`,
 * `openssl rand -base64 32`). Throws KeyMaterialError for any other length or alphabet, and for a key whose bytes are
 * all the same, which no random generator produces. It never puts the value in the message.
 */
export function parseKeyMaterial(text: string): Uint8Array<ArrayBuffer> {
  const trimmed = text.trim()
  let bytes: Uint8Array<ArrayBuffer> | undefined
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    bytes = new Uint8Array(KEY_BYTES)
    for (let i = 0; i < KEY_BYTES; i += 1) {
      bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16)
    }
  } else if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(trimmed)) {
    bytes = fromBase64Url(trimmed.replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_'))
  }
  if (bytes?.length !== KEY_BYTES) {
    throw new KeyMaterialError('a key is 32 random bytes written as 64 hex characters or as base64')
  }
  const first = bytes[0]
  if (bytes.every((byte) => byte === first)) {
    throw new KeyMaterialError('a key must be random, not one byte repeated')
  }
  return bytes
}

/** A key and the version number that names it in the ciphertext (`v1`, `v2`, ...). */
export interface VersionedKey {
  readonly version: number
  /** Exactly 32 bytes; see parseKeyMaterial. */
  readonly key: Uint8Array<ArrayBuffer>
}

export interface KeyRing {
  /** The version new values are written with. */
  readonly currentVersion: number
  /** Versions that can be read, the current one included. */
  readonly versions: readonly number[]
  /** `aad` names the field (`setting:smtp_password`). The same string must be given to decrypt(). */
  encrypt: (plaintext: string, aad: string) => Promise<EncryptedValue>
  /** Throws DecryptionError for a tampered or foreign value, a wrong `aad`, an unknown version or a malformed string. */
  decrypt: (value: string, aad: string) => Promise<string>
}

function checkVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
    throw new KeyMaterialError(`a key version is a whole number from 1 to ${String(MAX_VERSION)}`)
  }
}

/**
 * Builds a key ring from the current key and the older keys that must stay readable. Versions must be distinct. Call it
 * once at start-up (importing a key is async) and keep the result.
 */
export async function createKeyRing(current: VersionedKey, previous: readonly VersionedKey[] = []): Promise<KeyRing> {
  const all = [current, ...previous]
  const seen = new Set<number>()
  for (const entry of all) {
    checkVersion(entry.version)
    if (entry.key.length !== KEY_BYTES) {
      throw new KeyMaterialError('a key is 32 bytes')
    }
    if (seen.has(entry.version)) {
      throw new KeyMaterialError('two keys have the same version')
    }
    seen.add(entry.version)
  }

  const imported = new Map<number, CryptoKey>()
  for (const entry of all) {
    imported.set(
      entry.version,
      await crypto.subtle.importKey('raw', entry.key, ALGORITHM, false, ['encrypt', 'decrypt']),
    )
  }
  const currentKey = imported.get(current.version)
  if (currentKey === undefined) {
    throw new KeyMaterialError('the current key is missing')
  }

  return {
    currentVersion: current.version,
    versions: all.map((entry) => entry.version).sort((a, b) => a - b),

    async encrypt(plaintext, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: ALGORITHM, iv, additionalData: textEncoder.encode(aad), tagLength: TAG_BYTES * 8 },
          currentKey,
          textEncoder.encode(plaintext),
        ),
      )
      const joined = new Uint8Array(IV_BYTES + sealed.length)
      joined.set(iv, 0)
      joined.set(sealed, IV_BYTES)
      // Parsed, not cast: a value that does not fit the stored envelope (too long) is refused here, not at the database.
      return EncryptedValue.parse(`v${String(current.version)}:${toBase64Url(joined)}`)
    },

    async decrypt(value, aad) {
      const match = /^v([1-9]\d{0,3}):([A-Za-z0-9_-]+)$/.exec(value)
      const versionText = match?.[1]
      const body = match?.[2]
      if (versionText === undefined || body === undefined) {
        throw new DecryptionError()
      }
      const key = imported.get(Number(versionText))
      const joined = fromBase64Url(body)
      if (key === undefined || joined === undefined || joined.length < IV_BYTES + TAG_BYTES) {
        throw new DecryptionError()
      }
      try {
        const plain = await crypto.subtle.decrypt(
          {
            name: ALGORITHM,
            iv: joined.slice(0, IV_BYTES),
            additionalData: textEncoder.encode(aad),
            tagLength: TAG_BYTES * 8,
          },
          key,
          joined.slice(IV_BYTES),
        )
        return textDecoder.decode(plain)
      } catch {
        throw new DecryptionError()
      }
    },
  }
}
