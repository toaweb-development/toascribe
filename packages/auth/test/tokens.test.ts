import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { constantTimeEqual, csrfTokenFor, generateToken, hashToken } from '../src/tokens.ts'

describe('generateToken', () => {
  it('makes 43 base64url characters (256 bits) and no two alike', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()))
    expect(tokens.size).toBe(50)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })
})

describe('hashToken', () => {
  it('is the SHA-256 of the token in hex, without a key', () => {
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('constantTimeEqual', () => {
  it('compares equal strings, different strings and strings of different length', () => {
    expect(constantTimeEqual('same', 'same')).toBe(true)
    expect(constantTimeEqual('same', 'sama')).toBe(false)
    expect(constantTimeEqual('short', 'a much longer string')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})

describe('csrfTokenFor', () => {
  const key = new Uint8Array(32).fill(7)

  it('is stable for one session and key, and differs per session and per key', () => {
    expect(csrfTokenFor(key, 'session-1')).toBe(csrfTokenFor(key, 'session-1'))
    expect(csrfTokenFor(key, 'session-1')).not.toBe(csrfTokenFor(key, 'session-2'))
    expect(csrfTokenFor(key, 'session-1')).not.toBe(csrfTokenFor(new Uint8Array(32).fill(8), 'session-1'))
    expect(csrfTokenFor(key, 'session-1')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
