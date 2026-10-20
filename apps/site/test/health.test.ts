import { describe, expect, it, vi } from 'vitest'

import { createHealthApi } from '../app/lib/api/health.ts'

describe('health API layer', () => {
  it('asks /health and returns the parsed body', async () => {
    const api = vi.fn().mockResolvedValue({ status: 'ok', version: '0.1.0' })

    await expect(createHealthApi(api).get()).resolves.toEqual({ status: 'ok', version: '0.1.0' })
    expect(api).toHaveBeenCalledExactlyOnceWith('/health')
  })

  it('rejects a body that is not a HealthResponse', async () => {
    const api = vi.fn().mockResolvedValue({ status: 'degraded' })

    await expect(createHealthApi(api).get()).rejects.toThrow()
  })

  it('lets a network failure through for the page to show', async () => {
    const api = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(createHealthApi(api).get()).rejects.toThrow('ECONNREFUSED')
  })
})
