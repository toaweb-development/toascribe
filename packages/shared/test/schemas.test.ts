import { describe, expect, it } from 'vitest'

import { ApiError, HealthResponse, ReadyResponse } from '../src/index.ts'

describe('shared schemas', () => {
  it('HealthResponse accepts ok with a version and rejects anything else', () => {
    expect(HealthResponse.safeParse({ status: 'ok', version: '0.1.0' }).success).toBe(true)
    expect(HealthResponse.safeParse({ status: 'ok' }).success).toBe(false)
    expect(HealthResponse.safeParse({ status: 'down', version: '0.1.0' }).success).toBe(false)
  })

  it('ReadyResponse accepts both states and rejects unknown check values', () => {
    expect(ReadyResponse.safeParse({ status: 'ok', checks: { database: 'ok' } }).success).toBe(true)
    expect(ReadyResponse.safeParse({ status: 'unavailable', checks: { database: 'error' } }).success).toBe(true)
    expect(ReadyResponse.safeParse({ status: 'ok', checks: { database: 'slow' } }).success).toBe(false)
    expect(ReadyResponse.safeParse({ status: 'ok', checks: {} }).success).toBe(false)
  })

  it('ApiError needs a code and a message, and requestId is optional', () => {
    expect(ApiError.safeParse({ error: { code: 'not_found', message: 'Not found' } }).success).toBe(true)
    expect(ApiError.safeParse({ error: { code: 'not_found', message: 'Not found', requestId: 'r1' } }).success).toBe(
      true,
    )
    expect(ApiError.safeParse({ error: { message: 'Not found' } }).success).toBe(false)
  })
})
