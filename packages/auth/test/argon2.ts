import type { Algorithm } from '@node-rs/argon2'

// The library's `Algorithm` is a `const enum` that cannot be imported under verbatimModuleSyntax; these are its numbers.
/* eslint-disable @typescript-eslint/no-unsafe-enum-assignment -- the only place the numbers are written in the tests */
export const ARGON2D: Algorithm = 0
export const ARGON2I: Algorithm = 1
export const ARGON2ID: Algorithm = 2
/* eslint-enable @typescript-eslint/no-unsafe-enum-assignment */
