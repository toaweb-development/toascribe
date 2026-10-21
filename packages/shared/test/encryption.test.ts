import { describe, expect, it } from 'vitest'

import { DecryptionError, EncryptedValue, KeyMaterialError, createKeyRing, parseKeyMaterial } from '../src/index.ts'

const KEY_1 = parseKeyMaterial('6f7a1c2d3e4f5061728394a5b6c7d8e9f00112233445566778899aabbccddeef')
const KEY_2 = parseKeyMaterial('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU')

describe('parseKeyMaterial', () => {
  it('reads 64 hex characters, base64 and base64url, and gives 32 bytes', () => {
    expect(KEY_1).toHaveLength(32)
    expect(KEY_2).toHaveLength(32)
    expect(parseKeyMaterial(`${'ab'.repeat(16)}${'cd'.repeat(16)}`)).toHaveLength(32)
    // bytes that make the base64 contain + and /
    const odd = Uint8Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0xfb : 0xff))
    const oddB64 = btoa(String.fromCharCode(...odd))
    expect(oddB64).toMatch(/[+/]/)
    expect(parseKeyMaterial(oddB64)).toEqual(odd)
    expect(parseKeyMaterial(oddB64.replaceAll('+', '-').replaceAll('/', '_'))).toEqual(odd)
    // The same 32 bytes in base64, base64url and hex.
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const b64 = btoa(String.fromCharCode(...bytes))
    const b64url = b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    expect(parseKeyMaterial(hex)).toEqual(bytes)
    expect(parseKeyMaterial(b64)).toEqual(bytes)
    expect(parseKeyMaterial(b64url)).toEqual(bytes)
    expect(parseKeyMaterial(`  ${hex}\n`)).toEqual(bytes)
  })

  it('refuses a wrong length, a wrong alphabet and a key of one repeated byte, without printing the value', () => {
    for (const bad of [
      '',
      'short',
      'ab'.repeat(31),
      'ab'.repeat(33),
      'zz'.repeat(32),
      '00'.repeat(32),
      'A'.repeat(43),
    ]) {
      let message = ''
      try {
        parseKeyMaterial(bad)
      } catch (err) {
        expect(err).toBeInstanceOf(KeyMaterialError)
        message = err instanceof Error ? err.message : ''
      }
      expect(message).not.toBe('')
      if (bad !== '') {
        expect(message).not.toContain(bad)
      }
    }
  })
})

describe('createKeyRing', () => {
  const AAD = 'setting:smtp_password'

  it('round-trips and writes the v1:base64url envelope the EncryptedValue schema accepts', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    const sealed = await ring.encrypt('s3cret-smtp-pass', AAD)
    expect(sealed).toMatch(/^v1:[A-Za-z0-9_-]+$/)
    expect(EncryptedValue.safeParse(sealed).success).toBe(true)
    expect(sealed).not.toContain('s3cret')
    expect(await ring.decrypt(sealed, AAD)).toBe('s3cret-smtp-pass')
    // iv(12) + plaintext(16) + tag(16) = 44 bytes -> 59 base64url characters
    expect(sealed.slice(3)).toHaveLength(59)
  })

  it('handles the empty string and non-ASCII text', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    expect(await ring.decrypt(await ring.encrypt('', AAD), AAD)).toBe('')
    const text = 'pæsswörd – 密码 🔐'
    expect(await ring.decrypt(await ring.encrypt(text, AAD), AAD)).toBe(text)
  })

  it('uses a fresh IV every time', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    const first = await ring.encrypt('same', AAD)
    const second = await ring.encrypt('same', AAD)
    expect(first).not.toBe(second)
  })

  it('refuses to decrypt under another AAD, so a value cannot be moved to another field', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    const sealed = await ring.encrypt('totp-secret', 'mfa_credential:aaaa')
    await expect(ring.decrypt(sealed, 'mfa_credential:bbbb')).rejects.toBeInstanceOf(DecryptionError)
    await expect(ring.decrypt(sealed, 'setting:smtp_password')).rejects.toBeInstanceOf(DecryptionError)
    expect(await ring.decrypt(sealed, 'mfa_credential:aaaa')).toBe('totp-secret')
  })

  it('refuses a tampered value: any single changed character fails', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    const sealed = await ring.encrypt('totp-secret', AAD)
    const body = sealed.slice(3)
    for (let i = 0; i < body.length; i += 1) {
      const flipped = body[i] === 'A' ? 'B' : 'A'
      const tampered = `v1:${body.slice(0, i)}${flipped}${body.slice(i + 1)}`
      await expect(ring.decrypt(tampered, AAD), `character ${String(i)}`).rejects.toBeInstanceOf(DecryptionError)
    }
    await expect(ring.decrypt(`${sealed}A`, AAD)).rejects.toBeInstanceOf(DecryptionError)
    await expect(ring.decrypt(sealed.slice(0, -4), AAD)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('refuses malformed input and an unknown version, with the same generic error', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    const sealed = await ring.encrypt('x', AAD)
    const bad = [
      '',
      'v1:',
      'v1',
      'nonsense',
      `v2:${sealed.slice(3)}`,
      `v0:${sealed.slice(3)}`,
      `V1:${sealed.slice(3)}`,
      'v1:%%%',
    ]
    for (const value of bad) {
      const error = await ring.decrypt(value, AAD).then(
        () => undefined,
        (err: unknown) => err,
      )
      expect(error, value).toBeInstanceOf(DecryptionError)
      expect((error as Error).message).toBe('The value could not be decrypted')
    }
  })

  it('does not decrypt under another key', async () => {
    const one = await createKeyRing({ version: 1, key: KEY_1 })
    const other = await createKeyRing({ version: 1, key: KEY_2 })
    await expect(other.decrypt(await one.encrypt('x', AAD), AAD)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('rotates: a v2 key writes v2, and v1 values still decrypt', async () => {
    const old = await createKeyRing({ version: 1, key: KEY_1 })
    const v1 = await old.encrypt('written-long-ago', AAD)
    const rotated = await createKeyRing({ version: 2, key: KEY_2 }, [{ version: 1, key: KEY_1 }])
    expect(rotated.currentVersion).toBe(2)
    expect(rotated.versions).toEqual([1, 2])
    expect(await rotated.decrypt(v1, AAD)).toBe('written-long-ago')
    const v2 = await rotated.encrypt('written-today', AAD)
    expect(v2.startsWith('v2:')).toBe(true)
    expect(await rotated.decrypt(v2, AAD)).toBe('written-today')
    // Once the old key is dropped, the old value is gone for good: that is the point of dropping it.
    const dropped = await createKeyRing({ version: 2, key: KEY_2 })
    await expect(dropped.decrypt(v1, AAD)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('refuses an unusable ring: duplicate versions, a bad version, a short key', async () => {
    await expect(createKeyRing({ version: 1, key: KEY_1 }, [{ version: 1, key: KEY_2 }])).rejects.toBeInstanceOf(
      KeyMaterialError,
    )
    await expect(createKeyRing({ version: 0, key: KEY_1 })).rejects.toBeInstanceOf(KeyMaterialError)
    await expect(createKeyRing({ version: 10_000, key: KEY_1 })).rejects.toBeInstanceOf(KeyMaterialError)
    await expect(createKeyRing({ version: 1, key: new Uint8Array(16) })).rejects.toBeInstanceOf(KeyMaterialError)
  })

  it('refuses a plaintext that does not fit the stored envelope', async () => {
    const ring = await createKeyRing({ version: 1, key: KEY_1 })
    await expect(ring.encrypt('x'.repeat(4000), AAD)).rejects.toThrow()
  })
})
