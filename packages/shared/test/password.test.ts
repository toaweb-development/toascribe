import { describe, expect, it } from 'vitest'

import {
  GENERATED_PASSWORD_LENGTH,
  NewPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  generatePassword,
  passwordStrength,
} from '../src/index.ts'

describe('NewPassword', () => {
  it('takes eight characters and up to the maximum, and nothing outside', () => {
    expect(NewPassword.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true)
    expect(NewPassword.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false)
    expect(NewPassword.safeParse('a'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(true)
    expect(NewPassword.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false)
  })
})

describe('passwordStrength', () => {
  it('is 0 below the minimum length', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('Ab1!xyz')).toBe(0)
  })

  it('grows with length, which is what counts', () => {
    expect(passwordStrength('abcdefg1')).toBe(1)
    expect(passwordStrength('abcdefgh1jkl')).toBe(2)
    expect(passwordStrength('abcdefgh1jklmnop')).toBe(3)
    expect(passwordStrength('abcdefgh1jklmnopqrstuvwx')).toBe(4)
  })

  it('holds a one-class short password a step back, and a password of few different characters', () => {
    expect(passwordStrength('abcdefghijkl')).toBe(1)
    expect(passwordStrength('aaaaaaaaaaaa')).toBe(1)
    expect(passwordStrength('abababababababababababab')).toBe(3)
  })

  it('counts a character, not a UTF-16 unit', () => {
    // Seven characters, ten units.
    expect(passwordStrength('😀😀😀😀😀😀😀')).toBe(0)
    expect(passwordStrength('åæø åæø1')).toBe(1)
  })
})

describe('generatePassword', () => {
  it('makes 24 characters by default, from lower, upper, digits and symbols, all four present', () => {
    for (let n = 0; n < 200; n += 1) {
      const password = generatePassword()
      expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[2-9]/)
      expect(password).toMatch(/[!@#$%^&*\-_=+?]/)
      // Nothing that is easy to misread.
      expect(password).not.toMatch(/[01OIl]/)
      expect(NewPassword.safeParse(password).success).toBe(true)
      expect(passwordStrength(password)).toBe(4)
    }
  })

  it('never makes the same password twice', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()))
    expect(seen.size).toBe(500)
  })

  it('takes a length from 12 to 128 and refuses others', () => {
    expect(generatePassword(12)).toHaveLength(12)
    expect(generatePassword(128)).toHaveLength(128)
    expect(() => generatePassword(11)).toThrow(RangeError)
    expect(() => generatePassword(129)).toThrow(RangeError)
    expect(() => generatePassword(12.5)).toThrow(RangeError)
  })

  it('uses every character of the alphabet and no character much more than any other', () => {
    const counts = new Map<string, number>()
    for (let n = 0; n < 2000; n += 1) {
      for (const character of generatePassword(32)) {
        counts.set(character, (counts.get(character) ?? 0) + 1)
      }
    }
    // 25 + 24 + 8 + 13 = 70 characters; 64000 draws give about 914 each (plus the few that the class retry shifts).
    expect(counts.size).toBe(70)
    const values = [...counts.values()]
    expect(Math.min(...values)).toBeGreaterThan(750)
    expect(Math.max(...values)).toBeLessThan(1100)
  })
})
