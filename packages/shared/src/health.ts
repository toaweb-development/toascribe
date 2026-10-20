import { z } from 'zod'

/** GET /api/health: the process is up. Never touches the database. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
})
export type HealthResponse = z.infer<typeof HealthResponse>

export const READY_STATUS = ['ok', 'unavailable'] as const
export const CHECK_STATUS = ['ok', 'error'] as const

/** GET /api/ready: 200 when every check is ok, otherwise 503 with the same shape. */
export const ReadyResponse = z.object({
  status: z.enum(READY_STATUS),
  checks: z.object({
    database: z.enum(CHECK_STATUS),
  }),
})
export type ReadyResponse = z.infer<typeof ReadyResponse>
